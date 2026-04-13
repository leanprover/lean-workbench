import { requireAdmin } from '$lib/server/auth-helpers'
import { getConfig, saveConfig } from '$lib/server/config'
import { error, json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async ({ locals }) => {
  await requireAdmin(locals)
  const cfg = getConfig()
  return json({
    clientId: cfg.githubClientId ?? '',
  })
}

export const PUT: RequestHandler = async ({ locals, request }) => {
  await requireAdmin(locals)
  const { clientId, clientSecret } = (await request.json()) as {
    clientId: string
    clientSecret?: string
  }

  if (!clientId || typeof clientId !== 'string') {
    error(400, 'clientId is required')
  }

  const cfg = getConfig()

  // If clientSecret is omitted or empty, preserve the existing one
  let resolvedSecret = clientSecret
  if (!resolvedSecret) {
    if (!cfg.githubClientSecret) {
      error(400, 'clientSecret is required (no existing secret to preserve)')
    }
    resolvedSecret = cfg.githubClientSecret
  }

  cfg.githubClientId = clientId
  cfg.githubClientSecret = resolvedSecret
  saveConfig()

  return json({ ok: true })
}
