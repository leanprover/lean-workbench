import z from 'zod'

/** Server actions respond with data of this shape. */
export type ActionResponse<T = void> = { ok: T } | { error: string }

export const zSeedEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('log'), line: z.string() }),
  z.object({ type: z.literal('progress'), step: z.number(), total: z.number(), label: z.string() }),
  z.object({ type: z.literal('done') }),
  z.object({ type: z.literal('error'), message: z.string() }),
])
export type SeedEvent = z.infer<typeof zSeedEvent>

/** Assert a field in `formData` is a string or absent, return the empty string if it's absent */
export function formString(formData: FormData, name: string): string {
  const value = formData.get(name)
  if (value === null) return ''
  if (typeof value === 'string') return value
  throw new Error(`form field '${name}' is a File unexpectedly`)
}

/** Ensure that an unknown has the form of an Error by wrapping it if appropriate */
export const unknownAsError = (e: unknown) => (e instanceof Error ? e : new Error(String(e)))
