import 'server-only'

import path from 'node:path'

import { LEAN_VERSION_RE } from '@leanprover/workbench-shared'
import { getDataDir } from '@leanprover/workbench-shared/node'

import { type ActionResponse } from '@/lib/util'

import { getConfig, hasGithubAuth, saveConfig } from './config'
import { getTrackedCommandState, startTrackedCommand } from './trackedCommand'

export function startSeed(leanVersion: string | undefined): ActionResponse<boolean> {
  const cfg = getConfig()
  if (cfg.isSetupComplete) return { error: 'Already seeded' }
  if (!cfg.githubAuth) return { error: 'Configure GitHub authentication first' }
  if (leanVersion && !LEAN_VERSION_RE.test(leanVersion)) return { error: `Invalid Lean version ${leanVersion}` }

  const scriptsDir = path.join(process.cwd(), 'scripts') // scripts/ is a sibling directory
  const scriptsArgs = [path.join(scriptsDir, 'seed-volume.sh'), '--data-dir', getDataDir()]
  if (leanVersion) scriptsArgs.push('--lean-version', leanVersion)
  const emitter = startTrackedCommand('seed', 'bash', scriptsArgs)

  emitter?.on('exit', async exit => {
    // Note: success has already been reported to the client component;
    // if the saveConfig() fails, the config state will be out of sync
    // (We're basically pretending saveConfig() will never fail here.)
    if (exit.type === 'success') {
      getConfig().isSetupComplete = true
      await saveConfig()
    }
  })

  return { ok: !!emitter }
}

export type SetupStatus = 'not-configured' | 'configured' | 'show-tty' | 'seeded'

export async function fetchSetupStatus(): Promise<SetupStatus> {
  const cfg = getConfig()
  if (cfg.isSetupComplete) return 'seeded'
  if (!hasGithubAuth(cfg)) return 'not-configured'
  const st = getTrackedCommandState('seed')
  if (!st) return 'configured'
  return 'show-tty'
}
