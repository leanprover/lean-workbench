import type { BaseProject, BaseUser } from '@leanprover/workbench-shared'

import { CollabServerHandle } from './collabServer.ts'
import { buildProjectMount } from './projectMount.ts'
import { collabServers, mounts, vscServers } from './state.ts'
import { VscodeServerHandle } from './vscodeServer.ts'

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

    const acquireMount = () => mounts.acquire(project.id, () => buildProjectMount(owner, project, packageSets))

    const collabServerLease = await collabServers.acquire(project.id, async () => {
      const collabMountLease = await acquireMount()
      const collab = new CollabServerHandle(project, collabMountLease.value.bindArgs)
      collab.addDisposable(async () => collabMountLease[Symbol.asyncDispose]())
      return collab
    })
    vscServer.addDisposable(async () => collabServerLease[Symbol.asyncDispose]())

    const vscMountLease = await acquireMount()
    vscServer.addDisposable(async () => vscMountLease[Symbol.asyncDispose]())

    vscServer.start(vscMountLease.value.bindArgs, collabServerLease.value.workDir)
    await Promise.all([collabServerLease.value.start(), vscServer.started])

    // Resources allocated successfully, dispose later when the session actually exits.
    stack.move()
  }

  await vscServer.started
  return vscServer.vscodeIframeSrc
}
