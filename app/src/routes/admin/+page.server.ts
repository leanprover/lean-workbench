import { requireAdmin } from '$lib/server/auth-helpers'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals }) => {
  const user = await requireAdmin(locals)
  return { adminUsername: user.name }
}
