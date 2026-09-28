import fs from 'node:fs/promises'
import path from 'node:path'

import { SHARD_MANAGER_SOCK } from '@leanprover/workbench-shared'
import { createHTTPServer } from '@trpc/server/adapters/standalone'

import { inFlightTrpcMutations, serverIsStopping, shardManagerRouter } from './manager.ts'
import { collabServers, mounts, vscServers } from './state.ts'

const server = createHTTPServer({
  router: shardManagerRouter,
  maxBodySize: 100 * 1024, // Somewhat arbitrary default
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

async function shutdown(reason: string, error?: unknown) {
  console.log(`Shard manager shutdown triggered by ${reason}`, error)
  if (serverIsStopping.current) return
  serverIsStopping.current = true

  console.log('Closing server and finishing in-flight requests')
  await new Promise(resolve => server.close(resolve))
  // At this point, in-flight HTTP have terminated, but the requests may be ongoing:
  // we might still be trying to create a session, for example.
  // This await lets all these finish in an orderly manner.
  await settleAndLogErrors('waiting for in-flight procedures to finish', inFlightTrpcMutations)

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

process.once('SIGTERM', () => shutdown('SIGTERM'))
process.once('SIGINT', () => shutdown('SIGINT'))
process.once('uncaughtException', error => shutdown(`uncaught exception`, error))
process.on('unhandledRejection', error => {
  console.error('Unhandled rejection at the shard manager top level:', error)
})
