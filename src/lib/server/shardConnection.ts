import 'server-only'

import type { ShardManagerAPIRouter } from '@leanprover/workbench-shard-manager'
import { SHARD_MANAGER_SOCK } from '@leanprover/workbench-shared'
import { createTRPCClient, httpLink } from '@trpc/client'
import { Pool } from 'undici'

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

const dispatcher = new Pool('http://shard-connection-goes-over-uds/', { connect: { socketPath: SHARD_MANAGER_SOCK } })
const shardConnection = createTRPCClient<ShardManagerAPIRouter>({
  links: [
    httpLink({
      url: 'http://shard-connection-goes-over-uds/',
      fetch(url, init) {
        const options = { ...(init ?? {}), dispatcher }
        return fetch(url, options)
      },
    }),
  ],
})

export class ShardCoordinator {
  /**
   * Lease the project's shared {@link ProjectMountHandle}, building it if none exists.
   *
   * Publications use the same overlay mount as vscode sessions, and they can write to each
   * other's directories. Making this work correctly requires acquiring a lease from the
   * shard manager when we need to create a publication, and releasing it when we're done.
   * This can be somewhat simplified if and when publication-building is moved to shards.
   */
  async acquireProjectMount(owner: User, project: Project): Promise<AsyncDisposable & { readonly bindArgs: string[] }> {
    const packageSets = await getDb().projectPackageSet.findMany({ where: { projectId: project.id } })
    const { leaseId, bindArgs } = await shardConnection.acquireProjectMount.mutate({
      owner,
      project,
      packageSets: packageSets.map(({ packageSet }) => packageSet),
    })

    return {
      bindArgs,
      async [Symbol.asyncDispose]() {
        await shardConnection.releaseProjectMount.mutate({ leaseId })
      },
    }
  }

  /** Starts a session for `viewer` to read/edit `project` owned by `owner`,
   * reusing a current session if one already exists.
   * Assumes that `viewer` has permissions to view `project`.
   * Returns the path to the corresponding VSCode `iframe`. */
  async ensureSession(viewer: User, owner: User, project: Project): Promise<string> {
    const packageSets = await getDb().projectPackageSet.findMany({ where: { projectId: project.id } })
    const response = await shardConnection.ensureSession.mutate({
      viewer,
      owner,
      project,
      packageSets: packageSets.map(({ packageSet }) => packageSet),
    })
    return response.iframeUrl
  }

  async killSession(projectId: string, sessionId: string): Promise<void> {
    await shardConnection.killSession.mutate({ projectId, sessionId })
  }

  /** Return the path to `sessionId`'s VS Code UDS if `userId` is allowed to view it,
   * else `undefined`. */
  async socketPathForViewer(userId: string, sessionId: string): Promise<string | undefined> {
    const response = await shardConnection.getSocketPath.query({ sessionId })
    return response?.viewerId === userId ? response.socketPath : undefined
  }

  async ensureHomeDirectory(user: User) {
    return shardConnection.ensureUserHomeDir.mutate(user)
  }

  async listSessions(): Promise<(EditorSessionInfo | UnknownEditorSession)[]> {
    const result: (EditorSessionInfo | UnknownEditorSession)[] = []
    const sessions = await shardConnection.listSessions.query()
    for (const { projectId, servers } of sessions) {
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

/* NB: if shardConnection gains any state that would need to survive HMR,
 * this object should be attached to globalThis */
const shardCoordinator = new ShardCoordinator()
export function getShardCoordinator(): ShardCoordinator {
  return shardCoordinator
}
