import z from 'zod'

/** Server actions respond with data of this shape. */
export type ActionResponse<T = void> = { ok: T } | { error: string }

export const zTrackedCommandExit = z.discriminatedUnion('type', [
  z.object({ type: z.literal('success') }),
  z.object({ type: z.literal('killed'), signal: z.int() }),
  z.object({ type: z.literal('error'), exitCode: z.int() }),
])
export type TrackedCommandExit = z.infer<typeof zTrackedCommandExit>

export const zTrackedCommandEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('data'), data: z.string() }),
  z.object({ type: z.literal('exit'), exit: zTrackedCommandExit }),
  z.object({ type: z.literal('no-stream') }),
])
export type TrackedCommandEvent = z.infer<typeof zTrackedCommandEvent>

/** Ensure that an unknown has the form of an Error by wrapping it if appropriate */
export const unknownAsError = (e: unknown) => (e instanceof Error ? e : new Error(String(e)))
