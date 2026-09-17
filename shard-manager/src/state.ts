import type { CollabServerHandle } from './collabServer.ts'
import type { ProjectMountHandle } from './projectMount.ts'
import { RcMap } from './rcMap.ts'
import type { VscodeServerHandle } from './vscodeServer.ts'

/** projectId ↦ shared {@link ProjectMountHandle}
 *
 * Exactly one of these should exist per open project.
 * Leased by the project's collab-server
 * and by every VS Code server editing the project. */
export const mounts = new RcMap<string, ProjectMountHandle>()

/** projectId ↦ shared {@link CollabServerHandle}
 *
 * Exactly one of these should exist per open project.
 * Leased by every VS Code server editing the project. */
export const collabServers = new RcMap<string, CollabServerHandle>()

/** projectId ↦ [{@link VscodeServerHandle}s editing that project]
 *
 * Invariant: only contains *usable* servers,
 * that is ones which haven't been signaled to shut down or crashed.
 * Servers are removed immediately from this map when shutdown begins,
 * and resources are cleaned up afterwards. */
export const vscServers = new Map<string, VscodeServerHandle[]>()
