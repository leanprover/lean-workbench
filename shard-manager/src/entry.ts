import fs from 'node:fs/promises'
import { createServer, type ServerResponse } from 'node:http'
import path from 'node:path'

import {
  type ToShardRequests,
  type ToShardResponses,
  type ToShardRoute,
  toShardRoutes,
} from '@leanprover/workbench-shared'
import z from 'zod'

import { ensureSession } from './editorSessions.ts'
import { vscServers } from './state.ts'
const SHARD_MANAGER_PATH = '/api/shard-manager'
const SHARD_MANAGER_SOCK = '/tmp/lean-workbench/shard-manager.sock'
const SHARD_MAX_BODY_BYTES = 100 * 1024

function writeError(res: ServerResponse, status: number, message: string) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ error: message }))
}

const handlers: {
  [R in ToShardRoute]: (request: ToShardRequests[R]) => Promise<ToShardResponses[R]>
} = {
  ensureSession: async ({ viewer, owner, project, packageSets }) => {
    return { iframeUrl: await ensureSession(viewer, owner, project, packageSets) }
  },
  killShardClient: async () => {
    return {}
  },
  getSocketPath: async ({ sessionId }) => {
    for (const servers of vscServers.values()) {
      const s = servers.find(s => s.uuid === sessionId)
      if (s) return { socketPath: s.socketPath, viewerId: s.viewer.id }
    }
    return null
  },
}

/* Adapter for calling the handler in a type-checked manner */
const toShardContracts: { [R in ToShardRoute]: { request: { parse(data: unknown): ToShardRequests[R] } } } =
  toShardRoutes
function prepareHandler<R extends ToShardRoute>(route: R, data: unknown) {
  const request = toShardContracts[route].request.parse(data)
  return async () => {
    const response = await handlers[route](request)
    return JSON.stringify(toShardRoutes[route].response.parse(response))
  }
}

const server = createServer(async (req, res) => {
  try {
    // Check request
    if (req.method !== 'POST' || req.url !== SHARD_MANAGER_PATH) {
      writeError(res, 404, `Not found: ${req.method} ${req.url}`)
      return
    }

    // Read body
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of req) {
      const newChunk = chunk as Buffer // Because we don't setEncoding, we're certain to get a Buffer
      size += newChunk.length
      chunks.push(newChunk)
      if (size > SHARD_MAX_BODY_BYTES) {
        writeError(res, 413, 'request body too large')
        return
      }
    }

    // Parse response and obtain handler
    let responseThunk: () => Promise<string>
    try {
      const { route, data } = z
        .object({ route: z.enum(Object.keys(toShardRoutes) as ToShardRoute[]), data: z.unknown() })
        .parse(JSON.parse(Buffer.concat(chunks).toString('utf-8')))
      responseThunk = prepareHandler(route, data)
    } catch (e) {
      writeError(res, 400, `request body invalid: ${e instanceof Error ? e.message : String(e)}`)
      return
    }

    // Handle request request
    const response = await responseThunk()
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(response) })
    res.end(response)
  } catch (e) {
    writeError(res, 500, `unexpected error handling shard request: ${e instanceof Error ? e.message : String(e)}`)
  }
})

await fs.mkdir(path.dirname(SHARD_MANAGER_SOCK), { recursive: true, mode: 0o700 })
await fs.rm(SHARD_MANAGER_SOCK, { force: true })
server.listen(SHARD_MANAGER_SOCK, async () => {
  try {
    await fs.chmod(SHARD_MANAGER_SOCK, 0o600)
  } catch {
    console.error(`could not protect ${SHARD_MANAGER_SOCK}, aborting`)
    process.exit(1)
  }
  console.log(`shard manager listening at ${SHARD_MANAGER_SOCK}`)
})
