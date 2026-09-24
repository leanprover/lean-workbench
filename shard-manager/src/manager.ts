import { randomUUID } from 'node:crypto'

import { type ToShardRequests, type ToShardResponses, type ToShardRoute } from '@leanprover/workbench-shared'

import { ensureSession } from './editorSessions.ts'
import { buildProjectMount, type ProjectMountHandle } from './projectMount.ts'
import type { RcMapLease } from './rcMap.ts'
import { mounts, vscServers } from './state.ts'

const externallyLeasedProjectMountHandles: Map<string, RcMapLease<ProjectMountHandle>> = new Map()

export const handlers: { [R in ToShardRoute]: (request: ToShardRequests[R]) => Promise<ToShardResponses[R]> } = {
  acquireProjectMount: async ({ owner, project, packageSets }) => {
    const mount = await mounts.acquire(project.id, () => buildProjectMount(owner, project, packageSets))
    const leaseId = randomUUID()
    externallyLeasedProjectMountHandles.set(leaseId, mount)
    return { leaseId, bindArgs: mount.value.bindArgs }
  },

  releaseProjectMount: async ({ leaseId }) => {
    const lease = externallyLeasedProjectMountHandles.get(leaseId)
    externallyLeasedProjectMountHandles.delete(leaseId)
    await lease?.[Symbol.asyncDispose]()
    return null
  },

  ensureSession: async ({ viewer, owner, project, packageSets }) => {
    return { iframeUrl: await ensureSession(viewer, owner, project, packageSets) }
  },

  killSession: async ({ projectId, sessionId }) => {
    const projectSessions = vscServers.get(projectId) ?? []
    const session = projectSessions.find(s => s.uuid === sessionId)
    if (!session) {
      console.warn(`Tried to kill nonexistent editor session (ID ${sessionId})`)
      return null
    }
    vscServers.set(
      projectId,
      projectSessions.filter(s => s !== session),
    )
    await session[Symbol.asyncDispose]()
    return null
  },

  getSocketPath: async ({ sessionId }) => {
    for (const servers of vscServers.values()) {
      const s = servers.find(s => s.uuid === sessionId)
      if (s) return { socketPath: s.socketPath, viewerId: s.viewer.id }
    }
    return null
  },

  listSessions: async () => {
    return [...vscServers.entries().map(([projectId, servers]) => ({ projectId, servers }))]
  },
}
