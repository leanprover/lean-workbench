import 'server-only'

import { request } from 'node:http'

import {
  SHARD_MANAGER_PATH,
  SHARD_MANAGER_SOCK,
  type ToShardRequests,
  type ToShardResponses,
  type ToShardRoute,
  toShardRoutes,
} from '@leanprover/workbench-shared'
import { existsAsync } from '@leanprover/workbench-shared/node'

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

async function fetchFromShard<R extends ToShardRoute>(
  route: R,
  data: ToShardRequests[R],
): Promise<ToShardResponses[R]> {
  // TODO: make helper function for this logic and logic in lib/server/collabServer.ts
  const deadline = Date.now() + 10_000
  while (!(await existsAsync(SHARD_MANAGER_SOCK))) {
    if (Date.now() > deadline) throw new Error(`timeout waiting for ${SHARD_MANAGER_SOCK} to be available`)
    await new Promise(r => setTimeout(r, 50))
  }

  return new Promise<ToShardResponses[R]>((resolve, reject) => {
    const body = JSON.stringify({ route, data: toShardRoutes[route].request.parse(data) })
    const headers = { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }
    const req = request({ socketPath: SHARD_MANAGER_SOCK, path: SHARD_MANAGER_PATH, method: 'POST', headers }, res => {
      res.setEncoding('utf-8')
      const buf: string[] = []
      res.on('data', c => buf.push(String(c)))
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`Unexpected status code from socket request: ${res.statusCode}`))
        } else {
          try {
            const response = toShardRoutes[route].response.parse(JSON.parse(buf.join('')))
            resolve(response as ToShardResponses[R]) // Valid cast: typescript doesn't correlate the types automatically
          } catch (e) {
            reject(new Error(`shard route ${route} returned invalid data ${buf.join('')}: ${e}`))
          }
        }
      })
    })
    req.on('error', reject)
    req.end(body)
  })
}
export class ShardConnectionManager {
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
    const { leaseId, bindArgs } = await fetchFromShard('acquireProjectMount', {
      owner,
      project,
      packageSets: packageSets.map(({ packageSet }) => packageSet),
    })
    return {
      bindArgs,
      async [Symbol.asyncDispose]() {
        await fetchFromShard('releaseProjectMount', { leaseId })
      },
    }
  }

  /** Starts a session for `viewer` to read/edit `project` owned by `owner`,
   * reusing a current session if one already exists.
   * Assumes that `viewer` has permissions to view `project`.
   * Returns the path to the corresponding VSCode `iframe`. */
  async ensureSession(viewer: User, owner: User, project: Project): Promise<string> {
    const packageSets = await getDb().projectPackageSet.findMany({ where: { projectId: project.id } })
    const response = await fetchFromShard('ensureSession', {
      viewer,
      owner,
      project,
      packageSets: packageSets.map(({ packageSet }) => packageSet),
    })
    return response.iframeUrl
  }

  async killSession(projectId: string, sessionId: string): Promise<void> {
    await fetchFromShard('killSession', { projectId, sessionId })
  }

  /** Return the path to `sessionId`'s VS Code UDS if `userId` is allowed to view it,
   * else `undefined`. */
  async socketPathForViewer(userId: string, sessionId: string): Promise<string | undefined> {
    const response = await fetchFromShard('getSocketPath', { sessionId })
    return response?.viewerId === userId ? response.socketPath : undefined
  }

  async listSessions(): Promise<(EditorSessionInfo | UnknownEditorSession)[]> {
    const result: (EditorSessionInfo | UnknownEditorSession)[] = []
    const sessions = await fetchFromShard('listSessions', null)
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
const shardConnection = new ShardConnectionManager()
export function getShardConnection(): ShardConnectionManager {
  return shardConnection
}
