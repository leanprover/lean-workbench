import fs from 'node:fs/promises'
import path from 'node:path'

import { type BaseProject, type BaseUser, bwrapProjectDir } from '@leanprover/workbench-shared'
import {
  execFileAsync,
  getPackageSetsDir,
  getProjectDir,
  getUserRootDir,
  getWorkspacesDir,
} from '@leanprover/workbench-shared/node'

import { CollabServerHandle } from './collabServer.ts'
import { ProjectMountHandle } from './projectMount.ts'
import { collabServers, mounts, vscServers } from './state.ts'
import { VscodeServerHandle } from './vscodeServer.ts'

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
async function buildProjectMount(
  owner: { id: string; name: string },
  project: BaseProject,
  packageSets: string[],
): Promise<ProjectMountHandle> {
  let userDir = getUserRootDir(owner)
  let projectDir = getProjectDir(owner, project.id)
  try {
    try {
      await fs.access(projectDir)
    } catch {
      // Temporary fallback until we introduce `/data` migrations to handle existing projects:
      // if the folder doesn't exist in `workspaces/<ownerId>/foo`, check `workspaces/<ownerName>/foo`.
      userDir = path.join(getWorkspacesDir(), owner.name)
      projectDir = path.join(getWorkspacesDir(), owner.name, project.id)
      await fs.access(projectDir)
    }
  } catch (err) {
    throw new Error(`Could not open project directory '${projectDir}': ${String(err)}`)
  }

  const lowerDirs: string[] = []
  for (const packageSet of packageSets) {
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

/** Starts a session for `viewer` to read/edit `project` owned by `owner`,
 * reusing a current session if one already exists.
 * Assumes that `viewer` has permissions to view `project`.
 * Returns the path to the corresponding VSCode `iframe`. */
export async function ensureSession(
  viewer: BaseUser,
  owner: { id: string; name: string },
  project: BaseProject,
  packageSets: string[],
): Promise<string> {
  const projectSessions = vscServers.get(project.id) ?? []
  let vscServer = projectSessions.find(s => s.viewer.id === viewer.id)
  if (!vscServer) {
    await using stack = new AsyncDisposableStack()

    // Suffices to put `vscServer` on the stack:
    // all other resources are added as disposables to `vscServer`.
    vscServer = stack.use(new VscodeServerHandle(viewer, owner, project))
    vscServer.addDisposable(async () => {
      vscServers.set(
        project.id,
        (vscServers.get(project.id) ?? []).filter(s => s !== vscServer),
      )
    })
    // Store before any `await` so that concurrent calls for the same viewer reuse this handle.
    vscServers.set(project.id, [...projectSessions, vscServer])

    const makeMount = () => buildProjectMount(owner, project, packageSets)

    const collabServerLease = await collabServers.acquire(project.id, async () => {
      const collabMountLease = await mounts.acquire(project.id, makeMount)
      const collab = new CollabServerHandle(project, collabMountLease.value.bindArgs)
      collab.addDisposable(async () => collabMountLease[Symbol.asyncDispose]())
      return collab
    })
    vscServer.addDisposable(async () => collabServerLease[Symbol.asyncDispose]())

    const vscMountLease = await mounts.acquire(project.id, makeMount)
    vscServer.addDisposable(async () => vscMountLease[Symbol.asyncDispose]())

    vscServer.start(vscMountLease.value.bindArgs, collabServerLease.value.workDir)
    await Promise.all([collabServerLease.value.start(), vscServer.started])

    // Resources allocated successfully, dispose later when the session actually exits.
    stack.move()
  }

  await vscServer.started
  console.log({ vscodeIframeSrc: vscServer.vscodeIframeSrc })
  console.log({ vscServer })
  return vscServer.vscodeIframeSrc
}
