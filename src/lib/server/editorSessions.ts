import 'server-only'

import { CollabServerHandle } from '@shard/collabServer'
import { buildProjectMount, ProjectMountHandle } from '@shard/projectMount'
import { RcMap, type RcMapLease } from '@shard/rcMap'
import { VscodeServerHandle } from '@shard/vscodeServer'

import { type Project } from '@/prisma/generated/client'

import { type User } from './auth'
import { getDb } from './db'

export interface UnknownEditorSession {
  sessionId: string
  viewerId: string
  viewerUsername: string
  projectId: string
}

/** Admin-visible information about a running editor session. */
export interface EditorSessionInfo {
  sessionId: string
  viewerId: string
  viewerUsername: string
  ownerUsername: string
  projectId: string
  projectName: string
}

export class EditorSessionManager {
  /** projectId ↦ shared {@link ProjectMountHandle}
   *
   * Exactly one of these should exist per open project.
   * Leased by the project's collab-server
   * and by every VS Code server editing the project. */
  private mounts = new RcMap<string, ProjectMountHandle>()

  /** projectId ↦ shared {@link CollabServerHandle}
   *
   * Exactly one of these should exist per open project.
   * Leased by every VS Code server editing the project. */
  private collabServers = new RcMap<string, CollabServerHandle>()

  /** projectId ↦ [{@link VscodeServerHandle}s editing that project]
   *
   * Invariant: only contains *usable* servers,
   * that is ones which haven't been signaled to shut down or crashed.
   * Servers are removed immediately from this map when shutdown begins,
   * and resources are cleaned up afterwards. */
  private vscServers = new Map<string, VscodeServerHandle[]>()

  /** Lease the project's shared {@link ProjectMountHandle}, building it if none exists.
   *
   * Every sandbox that touches a project's files must go through here rather than mounting
   * the project itself: the overlay uses the project directory as its writable upper layer,
   * so a second independent mount of an already-open project would stack overlays on one
   * upper layer. */
  async acquireProjectMount(owner: User, project: Project): Promise<RcMapLease<ProjectMountHandle>> {
    return this.mounts.acquire(project.id, async () => {
      const packageSets = await getDb().projectPackageSet.findMany({ where: { projectId: project.id } })
      return buildProjectMount(
        owner,
        project,
        packageSets.map(({ packageSet }) => packageSet),
      )
    })
  }

  /** Starts a session for `viewer` to read/edit `project` owned by `owner`,
   * reusing a current session if one already exists.
   * Assumes that `viewer` has permissions to view `project`.
   * Returns the path to the corresponding VSCode `iframe`. */
  async ensureSession(viewer: User, owner: User, project: Project): Promise<string> {
    const projectSessions = this.vscServers.get(project.id) ?? []
    let vscServer = projectSessions.find(s => s.viewer.id === viewer.id)
    if (!vscServer) {
      await using stack = new AsyncDisposableStack()

      // Suffices to put `vscServer` on the stack:
      // all other resources are added as disposables to `vscServer`.
      vscServer = stack.use(new VscodeServerHandle(viewer, owner, project))
      vscServer.addDisposable(async () => {
        this.vscServers.set(
          project.id,
          (this.vscServers.get(project.id) ?? []).filter(s => s !== vscServer),
        )
      })
      // Store before any `await` so that concurrent calls for the same viewer reuse this handle.
      this.vscServers.set(project.id, [...projectSessions, vscServer])

      const collabServerLease = await this.collabServers.acquire(project.id, async () => {
        const collabMountLease = await this.acquireProjectMount(owner, project)
        const collab = new CollabServerHandle(project, collabMountLease.value.bindArgs)
        collab.addDisposable(async () => collabMountLease[Symbol.asyncDispose]())
        return collab
      })
      vscServer.addDisposable(async () => collabServerLease[Symbol.asyncDispose]())

      const vscMountLease = await this.acquireProjectMount(owner, project)
      vscServer.addDisposable(async () => vscMountLease[Symbol.asyncDispose]())

      vscServer.start(vscMountLease.value.bindArgs, collabServerLease.value.workDir)
      await Promise.all([collabServerLease.value.start(), vscServer.started])

      // Resources allocated successfully, dispose later when the session actually exits.
      stack.move()
    }

    await vscServer.started
    return vscServer.vscodeIframeSrc
  }

  killSession(projectId: string, sessionId: string): void {
    const projectSessions = this.vscServers.get(projectId) ?? []
    const session = projectSessions.find(s => s.uuid === sessionId)
    if (!session) {
      console.warn(`Tried to kill nonexistent editor session (ID ${sessionId})`)
      return
    }
    this.vscServers.set(
      projectId,
      projectSessions.filter(s => s !== session),
    )
    void session[Symbol.asyncDispose]()
  }

  /** Return the path to `sessionId`'s VS Code UDS if `userId` is allowed to view it,
   * else `undefined`. */
  socketPathForViewer(userId: string, sessionId: string): string | undefined {
    for (const servers of this.vscServers.values()) {
      const s = servers.find(s => s.uuid === sessionId)
      if (s) return s.viewer.id === userId ? s.socketPath : undefined
    }
    return undefined
  }

  async listSessions(): Promise<(EditorSessionInfo | UnknownEditorSession)[]> {
    const result: (EditorSessionInfo | UnknownEditorSession)[] = []
    for (const [projectId, servers] of this.vscServers) {
      const project = await getDb().project.findUnique({
        where: { id: projectId },
        select: { name: true, user: { select: { name: true } } },
      })
      if (!project) {
        console.error(`internal error: no database record for project with ID ${projectId}`)
      }
      for (const s of servers) {
        if (project) {
          result.push({
            sessionId: s.uuid,
            viewerId: s.viewer.id,
            viewerUsername: s.viewer.name,
            ownerUsername: project.user.name,
            projectId,
            projectName: project.name,
          })
        } else {
          result.push({
            sessionId: s.uuid,
            viewerId: s.viewer.id,
            viewerUsername: s.viewer.name,
            projectId,
          })
        }
      }
    }
    return result
  }
}

const g = globalThis as typeof globalThis & {
  __editorSessionManager?: EditorSessionManager
}

export async function initEditorSessions() {
  if (!g.__editorSessionManager) {
    g.__editorSessionManager = new EditorSessionManager()
  } else {
    // On HMR, modules re-evaluate and new classes are constructed;
    // rebind so that the global instance picks up updated methods.
    const m = g.__editorSessionManager
    Object.setPrototypeOf(m, EditorSessionManager.prototype)
    Object.setPrototypeOf(m['mounts'], RcMap.prototype)
    Object.setPrototypeOf(m['collabServers'], RcMap.prototype)
    for (const servers of m['vscServers'].values()) {
      for (const s of servers) Object.setPrototypeOf(s, VscodeServerHandle.prototype)
    }
    await m['mounts'].forEach(mount => Object.setPrototypeOf(mount, ProjectMountHandle.prototype) as unknown)
    await m['collabServers'].forEach(collab => Object.setPrototypeOf(collab, CollabServerHandle.prototype) as unknown)
  }
}

export function getEditorSessionManager(): EditorSessionManager {
  return g.__editorSessionManager!
}

await initEditorSessions()
