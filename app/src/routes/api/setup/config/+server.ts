import { getConfig, saveConfig } from '$lib/server/config'
import { error } from '@sveltejs/kit'
import type { RequestHandler } from './$types'

export const POST: RequestHandler = async ({ request }) => {
  const cfg = getConfig()
  if (cfg.isSetupComplete) {
    error(400, 'Setup already complete')
  }

  const { githubClientId, githubClientSecret } = (await request.json()) as {
    githubClientId: string
    githubClientSecret: string
  }

  if (!githubClientId || !githubClientSecret) {
    error(400, 'GitHub client ID and secret are required')
  }

  cfg.githubClientId = githubClientId
  cfg.githubClientSecret = githubClientSecret
  saveConfig()

  return new Response(null, { status: 204 })
}
