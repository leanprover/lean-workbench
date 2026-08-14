'use server'

import { initAuth } from '@/lib/server/auth'
import { getConfig, hasGithubAuth, saveConfig, zGithubAuthConfig } from '@/lib/server/config'
import { getSeedState, startSeed as doStartSeed } from '@/lib/server/seed'
import type { ActionResponse } from '@/lib/util'

export async function saveSetupConfig(formData: FormData): Promise<ActionResponse<boolean>> {
  const cfg = getConfig()
  if (cfg.isSetupComplete) return { error: 'Setup already completed' }

  const parsed = zGithubAuthConfig.safeParse({
    clientId: formData.get('clientId'),
    clientSecret: formData.get('clientSecret'),
  })
  if (!parsed.success) return { error: parsed.error.issues[0]!.message }

  const githubAuth = parsed.data
  cfg.githubAuth = githubAuth
  await saveConfig()

  // Reinitialize auth with new configuration
  await initAuth()

  return { ok: true }
}

export async function startSeed(leanVersion: string | undefined): Promise<ActionResponse<boolean>> {
  return doStartSeed(leanVersion)
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
