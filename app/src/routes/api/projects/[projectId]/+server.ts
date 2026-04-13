import { requireUser } from '$lib/server/auth-helpers'
import { getDb } from '$lib/server/db'
import { error, json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'

const PROJECT_NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,99}$/u

export const PUT: RequestHandler = async ({ locals, params, request }) => {
  const user = requireUser(locals)
  const db = getDb()

  const project = await db.project.findUnique({ where: { id: params.projectId } })
  if (!project || project.userId !== user.id) {
    error(404, 'Project not found')
  }

  const { name } = (await request.json()) as { name?: string }
  if (!name || !PROJECT_NAME_RE.test(name)) {
    error(400, 'Invalid project name')
  }

  await db.project.update({
    where: { id: project.id },
    data: { name },
  })

  return json({ ok: true })
}

export const DELETE: RequestHandler = async ({ locals, params }) => {
  const user = requireUser(locals)
  const db = getDb()

  const project = await db.project.findUnique({ where: { id: params.projectId } })
  if (!project || project.userId !== user.id) {
    error(404, 'Project not found')
  }

  await db.project.delete({ where: { id: project.id } })

  return json({ ok: true })
}
