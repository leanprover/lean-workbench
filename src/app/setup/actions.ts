'use server'

import { initAuth } from '@/lib/server/auth'
import { getConfig, hasGithubAuth, saveConfig } from '@/lib/server/config'
import { startSeed as doStartSeed, getSeedState } from '@/lib/server/seed'
import { ActionResponse } from '@/lib/util'
import z from 'zod'

const zSetupConfig = z.object({
  clientId: z.string().min(1, 'Client ID is required').trim(),
  clientSecret: z.string().min(1, 'Client Secret is required').trim(),
})

export async function saveSetupConfig(formData: FormData): Promise<ActionResponse<boolean>> {
  const cfg = getConfig()
  if (cfg.isSetupComplete) return { error: 'Setup already completed' }

  const parsed = zSetupConfig.safeParse({
    clientId: formData.get('clientId'),
    clientSecret: formData.get('clientSecret'),
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  cfg.githubAuth = parsed.data
  await saveConfig()

  // Reinitialize auth with new configuration
  await initAuth()

  return { ok: true }
}

export async function startSeed(): Promise<ActionResponse<boolean>> {
  return doStartSeed()
}

export async function fetchSetupStatus() {
  const cfg = getConfig()
  const st = getSeedState()
  return {
    configSaved: hasGithubAuth(cfg),
    seeding: st.inProgress,
    seeded: cfg.isSetupComplete,
  }
}
