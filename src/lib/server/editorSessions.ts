import type { User } from '@/lib/server/auth'
import { CollabServerHandle } from '@/lib/server/collabServer'
import { getPackageSetsDir, getWorkspacesDir } from '@/lib/server/config'
import { getDb } from '@/lib/server/db'
import { VscodeServerHandle } from '@/lib/server/vscodeServer'
import type { Project } from '@/prisma/generated/client'
import fs from 'node:fs/promises'
import path from 'node:path'
import { EventEmitter } from 'node:stream'
import 'server-only'
import { bwrapProjectDir } from './util'

/** Build `bwrap` arguments that mount the project and its package sets inside the sandbox.
 *
 * With no package sets, this is a writable bind of {@link projectDir}.
 *
 * Otherwise the project root is an overlayfs mount,
 * with {@link projectDir} as the writable upper layer
 * and each package overlaid as a read-only lower layer.
 * Package contents are expected to live on the host
 * at `<packageSetDir>/<pkg>/.lake/packages/<pkg>`,
 * so that mounting `<packageSetDir>/<pkg>` at the project root
 * merges into the correct location in the sandbox.
 *
 * Mount points cannot be removed from within the sandbox;
 * we prefer only mounting the project root directory
 * so that users can remove other directories freely.
 *
 * {@link overlayWorkDir} is the overlayfs work directory,
 * which per overlayfs requirements must be on the same filesystem as {@link projectDir}.
 * It should not be a subdirectory of {@link projectDir} to prevent access from the sandbox. */
async function buildProjectMount(
  projectId: string,
  projectName: string,
  projectDir: string,
  overlayWorkDir: string,
): Promise<string[]> {
  const dest = bwrapProjectDir(projectName)
  const packageSets = await getDb().projectPackageSet.findMany({ where: { projectId } })
  const lowerLayers: string[] = []
  for (const { packageSet } of packageSets) {
    const pkgSetDir = path.join(getPackageSetsDir(), packageSet)
    const packagesFile = path.join(pkgSetDir, 'packages.txt')
    let packages: string[]
    try {
      packages = (await fs.readFile(packagesFile, 'utf-8')).split('\n').filter(Boolean)
    } catch {
      console.error(`[buildProjectMount] failed to read ${packagesFile}`)
      continue
    }
    for (const pkg of packages) {
      lowerLayers.push('--overlay-src', path.join(pkgSetDir, pkg))
    }
  }
  if (lowerLayers.length === 0) return ['--bind', projectDir, dest]
  await fs.mkdir(overlayWorkDir, { recursive: true })
  return [...lowerLayers, '--overlay', projectDir, overlayWorkDir, dest]
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
  /** projectId ↦ [servers for that project]
   *
   * Invariant: only contains *usable* servers,
   * that is ones which haven't been signaled to shut down or crashed.
   * Servers are removed immediately from this map when shutdown begins,
   * and resources are cleaned up afterwards. */
  private vscServers = new Map<string, VscodeServerHandle[]>()
  /** These events fire *after* the relevant modification of {@link vscServers}.
   *
   * close - server has been shut down or has failed to start. */
  private vscServerEvents = new EventEmitter<{
    close: [VscodeServerHandle]
  }>()

  /** projectId ↦ server for that project
   *
   * Same invariant as in {@link vscServers}. */
  private collabServers = new Map<string, CollabServerHandle>()

  constructor() {
    this.vscServerEvents.addListener('close', s => {
      if ((this.vscServers.get(s.project.id) ?? []).length === 0) {
        // The last editor for this project has stopped - stop collab server.
        const server = this.collabServers.get(s.project.id)
        if (server) {
          this.collabServers.delete(s.project.id)
          void server.dispose()
        }
      }
    })
  }

  /** Find a running `collab-server` for the given project,
   * or create one and store it in {@link collabServers} if none are running.
   * Does not start the server. */
  private findCollabServer(project: Project): CollabServerHandle {
    let server = this.collabServers.get(project.id)
    if (!server) {
      server = new CollabServerHandle(project)
      server.addDisposable(async () => {
        const s = this.collabServers.get(project.id)
        if (s === server) this.collabServers.delete(project.id)
      })
      this.collabServers.set(project.id, server)
    }
    return server
  }

  /** Starts a session for `viewer` to read/edit `project` owned by `owner`,
   * reusing a current session if one already exists.
   * Assumes that `viewer` has permissions to view `project`.
   * Returns the path to the corresponding VSCode `iframe`. */
  async ensureSession(viewer: User, owner: User, project: Project): Promise<string> {
    const projectSessions = this.vscServers.get(project.id) ?? []
    let vscServer = projectSessions.find(s => s.viewer.id === viewer.id)
    if (!vscServer) {
      const projectDir = path.join(getWorkspacesDir(), owner.name, project.id)
      try {
        await fs.access(projectDir)
      } catch (err) {
        throw new Error(`Could not open project directory '${projectDir}': ${String(err)}`)
      }
      const overlayWorkDir = path.join(getWorkspacesDir(), owner.name, 'overlay-work', project.id)
      const projectMountArgs = await buildProjectMount(project.id, project.name, projectDir, overlayWorkDir)
      const collabServer = this.findCollabServer(project)
      collabServer.addDisposable(async () => {
        // collab-server is the last process to exit - remove the overlayfs workdir when it does.
        await fs.rm(overlayWorkDir, { recursive: true, force: true })
      })
      vscServer = new VscodeServerHandle(viewer, owner, project, collabServer.workDir)
      vscServer.addDisposable(async () => {
        this.vscServers.set(
          project.id,
          (this.vscServers.get(project.id) ?? []).filter(s => s !== vscServer),
        )
        this.vscServerEvents.emit('close', vscServer!)
      })
      // Insertion happens in same transaction as failed lookup (before any `await`)
      this.vscServers.set(project.id, [...(this.vscServers.get(project.id) ?? []), vscServer])

      await Promise.all([
        collabServer.start(projectMountArgs).catch(async e => {
          await collabServer.dispose()
          throw e
        }),
        vscServer.start(projectMountArgs).catch(async e => {
          await vscServer!.dispose()
          throw e
        }),
      ])
    }

    await vscServer.start([])
    return vscServer.vscodeIframePath
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
    void session.dispose()
  }

  /** Returns true iff `userId` is the viewer of the session `sessionId`. */
  isViewerOf(userId: string, sessionId: string): boolean {
    for (const servers of this.vscServers.values()) {
      const s = servers.find(s => s.uuid === sessionId)
      if (s) return s.viewer.id === userId
    }
    return false
  }

  async listSessions(): Promise<EditorSessionInfo[]> {
    const result: EditorSessionInfo[] = []
    for (const [projectId, servers] of this.vscServers) {
      const project = await getDb().project.findUnique({
        where: { id: projectId },
        select: { name: true, user: { select: { name: true } } },
      })
      if (!project) throw new Error(`internal error: unknown project ID ${projectId}`)
      for (const s of servers) {
        result.push({
          sessionId: s.uuid,
          viewerId: s.viewer.id,
          viewerUsername: s.viewer.name,
          ownerUsername: project.user.name,
          projectId,
          projectName: project.name,
        })
      }
    }
    return result
  }
}

const g = globalThis as typeof globalThis & {
  __editorSessionManager?: EditorSessionManager
}

export function initEditorSessions() {
  if (!g.__editorSessionManager) {
    g.__editorSessionManager = new EditorSessionManager()
  } else {
    // On HMR, modules re-evaluate and new classes are constructed;
    // rebind so that the global instance picks up updated methods.
    const m = g.__editorSessionManager
    Object.setPrototypeOf(m, EditorSessionManager.prototype)
    for (const servers of m['vscServers'].values()) {
      for (const s of servers) Object.setPrototypeOf(s, VscodeServerHandle.prototype)
    }
    for (const c of m['collabServers'].values()) {
      Object.setPrototypeOf(c, CollabServerHandle.prototype)
    }
  }
}

export function getEditorSessionManager(): EditorSessionManager {
  return g.__editorSessionManager!
}

initEditorSessions()
