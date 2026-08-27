'use server'

import { initAuth, requireAdmin } from '@/lib/server/auth'
import { getConfig, hasGithubAuth, saveConfig, zGithubAuthConfig } from '@/lib/server/config'
import { getSeedState, startSeed as doStartSeed } from '@/lib/server/seed'
import { submitAction } from '@/lib/server/util'
import type { ActionResponse } from '@/lib/util'

export const saveSetupConfig = submitAction(zGithubAuthConfig, async githubAuth => {
  await requireAdmin()

  const cfg = getConfig()
  if (cfg.isSetupComplete) return { error: 'Setup already completed' }

  cfg.githubAuth = githubAuth
  await saveConfig()

  // Reinitialize auth with new configuration
  await initAuth()

  return { ok: true }
})

export async function startSeed(leanVersion: string | undefined): Promise<ActionResponse<boolean>> {
  await requireAdmin()

  return doStartSeed(leanVersion)
}

export async function fetchSetupStatus() {
  await requireAdmin()

  const cfg = getConfig()
  const st = getSeedState()
  return {
    configSaved: hasGithubAuth(cfg),
    seeding: st.inProgress,
    seeded: cfg.isSetupComplete,
  }
}
