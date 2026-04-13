import { requireAdmin } from '$lib/server/auth-helpers'
import { getConfig, saveConfig } from '$lib/server/config'
import { error, json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async ({ locals }) => {
  await requireAdmin(locals)
  const cfg = getConfig()
  return json({ registrationMode: cfg.registrationMode })
}

export const PUT: RequestHandler = async ({ locals, request }) => {
  await requireAdmin(locals)
  const { registrationMode } = (await request.json()) as { registrationMode: string }
  if (registrationMode !== 'open' && registrationMode !== 'restricted') {
    error(400, 'Invalid registration mode')
  }
  const cfg = getConfig()
  cfg.registrationMode = registrationMode
  saveConfig()
  return json({ ok: true })
}
