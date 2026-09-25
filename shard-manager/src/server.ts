import fs from 'node:fs/promises'
import { createServer, IncomingMessage, type ServerResponse } from 'node:http'
import path from 'node:path'

import {
  SHARD_MANAGER_PATH,
  SHARD_MANAGER_SOCK,
  type ToShardRequests,
  type ToShardRoute,
  toShardRoutes,
} from '@leanprover/workbench-shared'
import z from 'zod'

import { handlers } from './manager.ts'
import { collabServers, mounts, vscServers } from './state.ts'

const SHARD_MAX_BODY_BYTES = 100 * 1024

function writeError(res: ServerResponse, status: number, message: string) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ error: message }))
}

/** Adapter for calling the handler in a type-checked manner */
const toShardContracts: { [R in ToShardRoute]: { request: { parse(data: unknown): ToShardRequests[R] } } } =
  toShardRoutes
function prepareHandler<R extends ToShardRoute>(route: R, data: unknown) {
  const request = toShardContracts[route].request.parse(data)
  return async () => {
    const response = await handlers[route](request)
    return JSON.stringify(toShardRoutes[route].response.parse(response))
  }
}

/**
 * Captures the duration of a request. Never throws.
 */
async function handleRequest(req: IncomingMessage, res: ServerResponse) {
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
}

const inFlightRequests = new Set<Promise<void>>()
const server = createServer(async (req, res) => {
  const inFlightRequest = handleRequest(req, res)
  inFlightRequests.add(inFlightRequest)
  await inFlightRequest
  inFlightRequests.delete(inFlightRequest)
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

async function settleAndLogErrors(action: string, promises: Iterable<Promise<unknown>>) {
  await Promise.allSettled(promises).then(results =>
    results.map(res => res.status === 'rejected' && console.error(`Error while ${action}:`, res.reason)),
  )
}

let stopping = false
async function shutdown() {
  console.log('Shard manager shutdown triggered')
  if (stopping) return
  stopping = true

  console.log('Closing server and finishing in-flight requests')
  await new Promise(resolve => server.close(resolve))
  await settleAndLogErrors('waiting for requests to finish', inFlightRequests)

  console.log('Terminating VSCode editor sessions')
  await settleAndLogErrors(
    'terminating VSCode editor session',
    vscServers
      .values()
      .flatMap(vscServersForProject => vscServersForProject.map(vscServer => vscServer[Symbol.asyncDispose]())),
  )

  console.log('Terminating collaboration servers')
  await collabServers[Symbol.asyncDispose]().catch((reason: unknown) =>
    console.error('Error terminating VSCode collaboration servers', reason),
  )

  console.log('Removing mount points')
  await mounts[Symbol.asyncDispose]().catch((reason: unknown) =>
    console.error('Error cleaning up mount points:', reason),
  )
}

process.once('SIGTERM', shutdown)
process.once('uncaughtException', shutdown)
process.once('unhandledRejection', shutdown)
