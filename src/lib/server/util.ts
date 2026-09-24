import 'server-only'

import { parseWithZod } from '@conform-to/zod/v4'
import { notFound } from 'next/navigation'
import type z from 'zod'

import type { ActionResponse } from '@/lib/util'
import type { Project } from '@/prisma/generated/client'

import { requireAuth, type User } from './auth'
import { getDb } from './db'

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

/** Resolve `<userName>/<projectName>` for an owner-only route,
 * where the requesting user must be the project's owner.
 *
 * Anything the requester may not act on is reported as 404 rather than 403,
 * so the route does not leak the existence of other people's projects. */
export async function requireProjectOwner(userName: string, projectName: string) {
  const { user: viewer } = await requireAuth()
  const db = getDb()
  const owner = await db.user.findUnique({ where: { name: userName } })
  if (!owner || owner.id !== viewer.id) notFound()
  const project = await db.project.findUnique({
    where: { userId_name: { userId: owner.id, name: projectName } },
  })
  if (!project) notFound()
  return { owner, project }
}
