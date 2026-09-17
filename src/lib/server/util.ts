import 'server-only'

import { parseWithZod } from '@conform-to/zod/v4'
import type z from 'zod'

import type { ActionResponse } from '@/lib/util'
import type { Project } from '@/prisma/generated/client'

import type { User } from './auth'

/** Wrap a server action so that its handler receives only schema-validated input.
 * The raw argument is parsed by {@link schema};
 * on failure the first parser error is returned. */
export function serverAction<S extends z.ZodType, T = void>(
  schema: S,
  handler: (input: z.infer<S>) => Promise<ActionResponse<T>>,
): (raw: z.input<S>) => Promise<ActionResponse<T>> {
  return async raw => {
    const parsed = schema.safeParse(raw)
    if (!parsed.success) return { error: parsed.error.issues[0]!.message }
    return handler(parsed.data)
  }
}

/** Wrap a server action so that it can directly accept `FormData`
 * while its handler will receive only schema-validated input.
 *
 * The [Conform](https://conform.guide/api/zod/parseWithZod) library
 * is used to adapt between `FormData` and the Zod schema.
 */
export function submitAction<S extends z.ZodType, T = void>(
  schema: S,
  handler: (input: z.infer<S>) => Promise<ActionResponse<T>>,
  options: { throwIfInvalid?: boolean } = {},
): (formData: FormData) => Promise<ActionResponse<T>> {
  return async formData => {
    const submission = parseWithZod(formData, {
      schema,
      formatError: (issues: z.core.$ZodIssue[]) => issues[0]!.message,
    })
    if (submission.status !== 'success') {
      const msg = Object.values(submission.error ?? {})[0] ?? `Error validating form submission`
      if (options.throwIfInvalid) throw new Error(msg)
      return { error: msg }
    }
    return handler(submission.value)
  }
}

export function canAccessProject(user: User, project: Project) {
  const isOwner = user.id === project.userId
  return isOwner || project.isPublic
}
