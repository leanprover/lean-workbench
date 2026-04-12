import { getConfig } from '$lib/server/config'
import { isSeedingInProgress } from '$lib/server/seedVolume'
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = () => {
  const cfg = getConfig()
  return json({
    githubConfigSaved: !!cfg.githubClientId && !!cfg.githubClientSecret,
    seeded: cfg.isSetupComplete,
    seeding: isSeedingInProgress(),
  })
}
