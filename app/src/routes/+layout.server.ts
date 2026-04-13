import { getConfig, isGithubEnabled } from '$lib/server/config'
import { redirect } from '@sveltejs/kit'
import type { LayoutServerLoad } from './$types'

export const load: LayoutServerLoad = event => {
  const cfg = getConfig()
  
  // Setup guard: redirect all pages to `/setup` until setup is complete
  if (!cfg.isSetupComplete) {
    const p = event.url.pathname
    if (p !== '/setup') {
      redirect(302, '/setup')
    }
  }

  return {
    isGithubEnabled: isGithubEnabled(cfg),
    isDevMode: cfg.isDevMode,
    isSetupComplete: cfg.isSetupComplete,
  }
}
