import { requireAdmin } from '$lib/server/auth-helpers'
import { getDb } from '$lib/server/db'
import { error, json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async ({ locals }) => {
  await requireAdmin(locals)
  const rows = await getDb().allowedGithubUser.findMany({ orderBy: { githubUsername: 'asc' } })
  return json(rows.map(r => r.githubUsername))
}

export const POST: RequestHandler = async ({ locals, request }) => {
  await requireAdmin(locals)
  const { username } = (await request.json()) as { username: string }
  if (!username || typeof username !== 'string') {
    error(400, 'Username is required')
  }
  await getDb().allowedGithubUser.upsert({
    where: { githubUsername: username.trim() },
    update: {},
    create: { githubUsername: username.trim() },
  })
  return json({ ok: true })
}
