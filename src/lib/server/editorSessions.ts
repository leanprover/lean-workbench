import 'server-only'

import fs from 'node:fs/promises'
import { request } from 'node:http'

import {
  type ToShardRequests,
  type ToShardResponses,
  type ToShardRoute,
  toShardRoutes,
} from '@leanprover/workbench-shared'
import { existsAsync } from '@leanprover/workbench-shared/node'
import { getDb } from './db'
import { User } from './auth'
import { Project } from '@/prisma/generated/client'

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

const SHARD_MANAGER_SOCK = '/tmp/lean-workbench/shard-manager.sock'
const SHARD_MANAGER_PATH = '/api/shard-manager'

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
    const body = JSON.stringify({ route, data })
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

export class EditorSessionManager {
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

  killSession(projectId: string, sessionId: string): void {
    throw new Error('unimplemented')
    /*
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
    void session[Symbol.asyncDispose]() */
  }

  /** Return the path to `sessionId`'s VS Code UDS if `userId` is allowed to view it,
   * else `undefined`. */
  async socketPathForViewer(userId: string, sessionId: string): Promise<string | undefined> {
    const response = await fetchFromShard('getSocketPath', { sessionId })
    if (!response) return undefined
    return response.viewerId === userId ? response.socketPath : undefined
  }

  async listSessions(): Promise<(EditorSessionInfo | UnknownEditorSession)[]> {
    throw new Error('unmplemented')
    /*
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
  */
  }
}

const g = globalThis as typeof globalThis & {
  __editorSessionManager?: EditorSessionManager
}

export function getEditorSessionManager(): EditorSessionManager {
  return g.__editorSessionManager!
}

g.__editorSessionManager = new EditorSessionManager()
