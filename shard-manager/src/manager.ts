/*
 * In this file, we use tRPC to construct the shard manager API.
 */

import { randomUUID } from 'node:crypto'

import { zBaseProject, zBaseUser, zProjectId, zUserId, zUserName } from '@leanprover/workbench-shared'
import { initTRPC, TRPCError } from '@trpc/server'
import { z } from 'zod'

import { ensureSession as ensureSessionImpl } from './editorSessions.ts'
import { buildProjectMount, type ProjectMountHandle } from './projectMount.ts'
import type { RcMapLease } from './rcMap.ts'
import { mounts, vscServers } from './state.ts'
import { ensureUserHomeDir as ensureUserHomeDirImpl } from './user.ts'

const t = initTRPC.create()

/** Parses according to {@link schema} and includes the input in parse errors. */
const reportingParse =
  <S extends z.ZodType>(schema: S) =>
  (input: unknown) =>
    schema.parse(input, { reportInput: true })

/**
 * We want graceful shutdown to completely finish all in-flight mutations before terminating,
 * This is accomplished by wrapping the mutations we want to finish in `trackMutation`.
 * The mutation won't run if the server is marked as preparing to shut down,
 * and the mutation will be waited on (with `Promise.allSettled`) as part of orderly shutdown.
 */
async function trackMutation<Output>(thunk: () => Promise<Output>): Promise<Output> {
  if (serverIsStopping.current) throw new TRPCError({ code: 'SERVICE_UNAVAILABLE' })
  const mutation = thunk()
  inFlightTrpcMutations.add(mutation)
  try {
    return await mutation
  } finally {
    inFlightTrpcMutations.delete(mutation)
  }
}
export const serverIsStopping = { current: false }
export const inFlightTrpcMutations = new Set<Promise<unknown>>()

/**
 * In order to delay moving publication to shards, we need a way of leasing
 * (and returning the lease for) a ProjectMountHandle.
 */
const acquireProjectMount = t.procedure
  .input(reportingParse(z.object({ owner: zBaseUser, project: zBaseProject, packageSets: z.array(z.string()) })))
  .output(reportingParse(z.object({ leaseId: z.uuidv4(), bindArgs: z.array(z.string()) })))
  .mutation(opts =>
    trackMutation(async () => {
      const { owner, project, packageSets } = opts.input
      const mount = await mounts.acquire(project.id, () => buildProjectMount(owner, project, packageSets))
      const leaseId = randomUUID()
      externallyLeasedProjectMountHandles.set(leaseId, mount)
      return { leaseId, bindArgs: mount.value.bindArgs }
    }),
  )

/** Release mount lease acquired by `acquireProjectMount` */
const releaseProjectMount = t.procedure
  .input(reportingParse(z.object({ leaseId: z.uuidv4() })))
  .output(reportingParse(z.null()))
  .mutation(opts =>
    trackMutation(async () => {
      const lease = externallyLeasedProjectMountHandles.get(opts.input.leaseId)
      externallyLeasedProjectMountHandles.delete(opts.input.leaseId)
      await lease?.[Symbol.asyncDispose]()
      return null
    }),
  )
const externallyLeasedProjectMountHandles: Map<string, RcMapLease<ProjectMountHandle>> = new Map()

/**
 * Build a home directory for the user if it doesn't exist.
 * (Hopefully) temporary, only needed to support publication workflow within Next.js
 */
const ensureUserHomeDir = t.procedure
  .input(reportingParse(zBaseUser))
  .output(reportingParse(z.object({ homeDir: z.string() })))
  .mutation(opts =>
    trackMutation(async () => {
      return { homeDir: await ensureUserHomeDirImpl(opts.input) }
    }),
  )

/**
 * Ensure an editor session exists for `viewer` on `owner/project`.
 * Returns a URL to point the editor iframe at.
 */
const ensureSession = t.procedure
  .input(
    reportingParse(
      z.object({
        viewer: zBaseUser,
        owner: z.object({ id: z.string(), name: z.string() }),
        project: zBaseProject,
        packageSets: z.array(z.string()),
      }),
    ),
  )
  .output(reportingParse(z.object({ iframeUrl: z.string() })))
  .mutation(opts =>
    trackMutation(async () => {
      const { viewer, owner, project, packageSets } = opts.input
      return { iframeUrl: await ensureSessionImpl(viewer, owner, project, packageSets) }
    }),
  )

const killSession = t.procedure
  .input(reportingParse(z.object({ projectId: zProjectId, sessionId: z.string() })))
  .output(reportingParse(z.null()))
  .mutation(opts =>
    trackMutation(async () => {
      const { projectId, sessionId } = opts.input
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
    }),
  )

/** Returns the socket path and viewer associated with a specific session */
const getSocketPath = t.procedure
  .input(reportingParse(z.object({ sessionId: z.string() })))
  .output(reportingParse(z.object({ socketPath: z.string(), viewerId: zUserId }).nullable()))
  .query(async opts => {
    for (const servers of vscServers.values()) {
      const s = servers.find(s => s.uuid === opts.input.sessionId)
      if (s) return { socketPath: s.socketPath, viewerId: s.viewer.id }
    }
    return null
  })

const listSessions = t.procedure
  .output(
    reportingParse(
      z.array(
        z.object({
          projectId: zProjectId,
          servers: z.array(z.object({ uuid: z.uuidv4(), viewer: z.object({ id: zUserId, name: zUserName }) })),
        }),
      ),
    ),
  )
  .query(() => {
    return [...vscServers.entries().map(([projectId, servers]) => ({ projectId, servers }))]
  })

export const shardManagerRouter = t.router({
  acquireProjectMount,
  releaseProjectMount,
  ensureSession,
  getSocketPath,
  killSession,
  listSessions,
  ensureUserHomeDir,
})

export type ShardManagerAPIRouter = typeof shardManagerRouter
