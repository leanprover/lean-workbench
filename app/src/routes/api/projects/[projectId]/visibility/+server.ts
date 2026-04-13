import { requireUser } from '$lib/server/auth-helpers'
import { getDb } from '$lib/server/db'
import { error, json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'

export const PUT: RequestHandler = async ({ locals, params, request }) => {
  const user = requireUser(locals)
  const db = getDb()

  const project = await db.project.findUnique({ where: { id: params.projectId } })
  if (!project || project.userId !== user.id) {
    error(404, 'Project not found')
  }

  const body = (await request.json()) as { public?: boolean }
  if (typeof body.public !== 'boolean') {
    error(400, '"public" must be a boolean')
  }

  await db.project.update({
    where: { id: project.id },
    data: { isPublic: body.public },
  })

  return json({ ok: true })
}
