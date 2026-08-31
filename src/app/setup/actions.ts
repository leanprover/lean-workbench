'use server'

import z from 'zod'

import { initAuth, requireAdmin } from '@/lib/server/auth'
import { getConfig, saveConfig, zGithubAuthConfig } from '@/lib/server/config'
import { startSeed as doStartSeed } from '@/lib/server/seed'
import { getTrackedCommandState } from '@/lib/server/trackedCommand'
import { submitAction } from '@/lib/server/util'

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

export const doSeed = submitAction(z.object({ leanVersion: z.string().optional() }), async ({ leanVersion }) => {
  await requireAdmin()
  return doStartSeed(!leanVersion || leanVersion === 'Latest' ? undefined : leanVersion)
})

export async function isTrackedCommandRunning(key: string) {
  await requireAdmin()
  return getTrackedCommandState(key)?.status === 'running'
}
