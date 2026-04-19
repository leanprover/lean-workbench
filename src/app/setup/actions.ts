'use server'

import { initAuth } from '@/lib/server/auth'
import * as CacheTag from '@/lib/server/cacheTags'
import { getConfig, hasGithubAuth, saveConfig } from '@/lib/server/config'
import { startSeed as doStartSeed, getSeedState } from '@/lib/server/seed'
import { ActionResponse } from '@/lib/util'
import { updateTag } from 'next/cache'
import z from 'zod'

const zSetupConfig = z.object({
  baseUrl: z.url('Invalid base URL'),
  clientId: z.string().min(1, 'Invalid GitHub client ID').trim(),
  clientSecret: z.string().min(1, 'Invalid GitHub client secret').trim(),
})

export async function saveSetupConfig(formData: FormData): Promise<ActionResponse<boolean>> {
  const cfg = getConfig()
  if (cfg.isSetupComplete) return { error: 'Setup already completed' }

  const parsed = zSetupConfig.safeParse({
    baseUrl: formData.get('baseUrl'),
    clientId: formData.get('clientId'),
    clientSecret: formData.get('clientSecret'),
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const { baseUrl, ...githubAuth } = parsed.data
  cfg.baseUrl = baseUrl
  cfg.githubAuth = githubAuth
  await saveConfig()

  // Reinitialize auth with new configuration
  await initAuth()

  return { ok: true }
}

export async function startSeed(): Promise<ActionResponse<boolean>> {
  return doStartSeed()
}

export async function finalizeSeed() {
  // Re-render components that read the server configuration, e.g. the root layout.
  // Cannot be done in `on('close')` in `seed.ts`
  // since that runs after the parent Server Function returns,
  // so `updateTag` there would be a no-op.
  updateTag(CacheTag.serverConfig)
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
