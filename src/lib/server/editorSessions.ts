import { RcMap } from '@/lib/rcMap'
import type { User } from '@/lib/server/auth'
import { CollabServerHandle } from '@/lib/server/collabServer'
import { getPackageSetsDir, getWorkspacesDir } from '@/lib/server/config'
import { getDb } from '@/lib/server/db'
import { bwrapProjectDir } from '@/lib/server/util'
import { VscodeServerHandle } from '@/lib/server/vscodeServer'
import type { Project } from '@/prisma/generated/client'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import 'server-only'

const execFileAsync = promisify(execFile)

class ProjectMountHandle implements AsyncDisposable {
  constructor(
    /** `bwrap` args to bind the project tree, passed to sandboxes that access the project. */
    readonly bindArgs: string[],
    /** Host overlayfs mount backing {@link bindArgs}, torn down on disposal;
     * absent when the project has no package sets. */
    private readonly overlay?: { mergedDir: string; workDir: string },
  ) {}

  async [Symbol.asyncDispose]() {
    if (!this.overlay) return
    const { mergedDir, workDir } = this.overlay
    try {
      await execFileAsync('umount', [mergedDir])
      await Promise.all([
        fs.rm(workDir, { recursive: true, force: true }),
        fs.rm(mergedDir, { recursive: true, force: true }),
      ])
    } catch (e) {
      console.error(`[ProjectMountHandle] failed to tear down overlay '${mergedDir}': ${String(e)}`)
    }
  }
}

/** Allocate the filesystem resources necessary to bind the given project in `bwrap` sandboxes,
 * and compute the `bwrap` arguments to bind it.
 * - If the project depends on zero package sets,
 *   no resources are necessary (and disposal is a no-op).
 *   `bwrap` arguments `--bind` the project directory directly.
 * - Otherwise a new overlayfs is mounted on the host
 *   with the project directory as the writable upper layer
 *   and each package as a read-only lower layer.
 *  `bwrap` arguments bind the merged (overlayfs) directory.
 *   - Package contents are expected to live on the host
 *     at `<packageSetDir>/<pkg>/.lake/packages/<pkg>`,
 *     so that mounting `<packageSetDir>/<pkg>` at the project root
 *     merges into the correct location in the overlay.
 *
 * Note: since mountpoints cannot be removed from within the sandbox,
 * we prefer only mounting the project root directory
 * so that users can remove other directories (e.g. packages) freely. */
async function buildProjectMount(owner: User, project: Project): Promise<ProjectMountHandle> {
  const userDir = path.join(getWorkspacesDir(), owner.name)
  const projectDir = path.join(userDir, project.id)
  try {
    await fs.access(projectDir)
  } catch (err) {
    throw new Error(`Could not open project directory '${projectDir}': ${String(err)}`)
  }

  const packageSets = await getDb().projectPackageSet.findMany({ where: { projectId: project.id } })
  const lowerDirs: string[] = []
  for (const { packageSet } of packageSets) {
    const pkgSetDir = path.join(getPackageSetsDir(), packageSet)
    const packagesFile = path.join(pkgSetDir, 'packages.txt')
    let packages: string[]
    try {
      packages = (await fs.readFile(packagesFile, 'utf-8')).split('\n').filter(Boolean)
    } catch {
      console.error(`[buildProjectMount] Failed to read ${packagesFile}`)
      continue
    }
    for (const pkg of packages) lowerDirs.push(path.join(pkgSetDir, pkg))
  }

  const sandboxProjectDir = bwrapProjectDir(project.name)
  if (lowerDirs.length === 0) return new ProjectMountHandle(['--bind', projectDir, sandboxProjectDir])

  // The overlayfs work directory must, per overlayfs requirements,
  // be on the same filesystem as the project directory.
  // It should also not be a subdirectory of the project directory
  // in order to prevent access from the sandbox.
  const workDir = path.join(userDir, 'overlay-work', project.id)
  const mergedDir = path.join(userDir, 'overlay-merged', project.id)
  await Promise.all([fs.mkdir(mergedDir, { recursive: true }), fs.mkdir(workDir, { recursive: true })])
  const options = `lowerdir=${lowerDirs.join(':')},upperdir=${projectDir},workdir=${workDir}`
  await execFileAsync('mount', ['--types', 'overlay', 'overlay', '--options', options, mergedDir])
  const handle = new ProjectMountHandle(['--bind', mergedDir, sandboxProjectDir], { mergedDir, workDir })
  // overlayfs silently falls back to a read-only mount if it can't set up its work directory
  // (e.g. when `workDir`'s filesystem doesn't support being an overlayfs upper layer).
  try {
    await fs.access(mergedDir, fs.constants.W_OK)
  } catch (err) {
    await handle[Symbol.asyncDispose]()
    throw new Error(`Overlayfs at '${mergedDir}' is not writable. Inspect the Linux kernel log.\n${String(err)}`)
  }
  return handle
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

      const makeMount = () => buildProjectMount(owner, project)

      const collabServerLease = await this.collabServers.acquire(project.id, async () => {
        const collabMountLease = await this.mounts.acquire(project.id, makeMount)
        const collab = new CollabServerHandle(project, collabMountLease.value.bindArgs)
        collab.addDisposable(async () => collabMountLease[Symbol.asyncDispose]())
        return collab
      })
      vscServer.addDisposable(async () => collabServerLease[Symbol.asyncDispose]())

      const vscMountLease = await this.mounts.acquire(project.id, makeMount)
      vscServer.addDisposable(async () => vscMountLease[Symbol.asyncDispose]())

      vscServer.start(vscMountLease.value.bindArgs, collabServerLease.value.workDir)
      await Promise.all([collabServerLease.value.start(), vscServer.started])

      // Resources allocated successfully, dispose later when the session actually exits.
      stack.move()
    }

    await vscServer.started
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
    await m['mounts'].forEach(mount => Object.setPrototypeOf(mount, ProjectMountHandle.prototype))
    await m['collabServers'].forEach(collab => Object.setPrototypeOf(collab, CollabServerHandle.prototype))
  }
}

export function getEditorSessionManager(): EditorSessionManager {
  return g.__editorSessionManager!
}

await initEditorSessions()
