import { requireAdmin } from '$lib/server/auth-helpers'
import { getDb } from '$lib/server/db'
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'

export const DELETE: RequestHandler = async ({ locals, params }) => {
  await requireAdmin(locals)
  await getDb().allowedGithubUser.deleteMany({ where: { githubUsername: params.username } })
  return json({ ok: true })
}
