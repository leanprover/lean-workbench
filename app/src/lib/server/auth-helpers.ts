import { getDb } from '$lib/server/db'
import { error } from '@sveltejs/kit'

/** Require an authenticated user. Throws 401 if not logged in. */
export function requireUser(locals: App.Locals) {
  if (!locals.user) {
    error(401, 'Not logged in')
  }
  return locals.user
}

/** Require an authenticated admin user. Throws 401/403 if not logged in or not admin. */
export async function requireAdmin(locals: App.Locals) {
  const user = requireUser(locals)
  const dbUser = await getDb().user.findUnique({
    where: { id: user.id },
    select: { isAdmin: true },
  })
  if (!dbUser?.isAdmin) {
    error(403, 'Forbidden')
  }
  return user
}
