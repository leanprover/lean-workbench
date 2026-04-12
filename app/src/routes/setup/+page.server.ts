import { getConfig } from '$lib/server/config'
import { redirect } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = () => {
  const cfg = getConfig()
  if (cfg.isSetupComplete) {
    redirect(302, '/')
  }
}
