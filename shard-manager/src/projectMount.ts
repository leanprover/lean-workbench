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

export class ProjectMountHandle implements AsyncDisposable {
  /** `bwrap` args to bind the project tree, passed to sandboxes that access the project. */
  readonly bindArgs
  /** Host overlayfs mount backing {@link bindArgs}, torn down on disposal;
   * absent when the project has no package sets. */
  private readonly overlay

  constructor(bindArgs: string[], overlay?: { mergedDir: string; workDir: string }) {
    this.bindArgs = bindArgs
    this.overlay = overlay
  }

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
export async function buildProjectMount(
  owner: BaseUser,
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
