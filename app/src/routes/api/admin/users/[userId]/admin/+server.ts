import { requireAdmin } from '$lib/server/auth-helpers'
import { getDb } from '$lib/server/db'
import { error, json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'

export const PUT: RequestHandler = async ({ locals, params, request }) => {
  const admin = await requireAdmin(locals)
  const { userId } = params

  if (userId === admin.id) {
    error(400, 'Cannot change your own admin status')
  }

  const db = getDb()
  const target = await db.user.findUnique({ where: { id: userId } })
  if (!target) {
    error(404, 'User not found')
  }

  const { admin: value } = (await request.json()) as { admin: boolean }
  if (typeof value !== 'boolean') {
    error(400, 'admin must be a boolean')
  }

  await db.user.update({ where: { id: userId }, data: { isAdmin: value } })
  return json({ ok: true })
}
