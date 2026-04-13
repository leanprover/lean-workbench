import { requireAdmin } from '$lib/server/auth-helpers'
import { getDb } from '$lib/server/db'
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async ({ locals }) => {
  await requireAdmin(locals)
  const users = await getDb().user.findMany({
    select: { id: true, name: true, isAdmin: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  })
  return json(users)
}
