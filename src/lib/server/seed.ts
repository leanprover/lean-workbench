import 'server-only'

import path from 'node:path'

import { LEAN_VERSION_RE } from '@leanprover/workbench-shared'
import { getDataDir } from '@leanprover/workbench-shared/node'

import { type ActionResponse } from '@/lib/util'

import { getConfig, saveConfig } from './config'
import { startTrackedCommand } from './stream'

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
    if (exit.type === 'success') {
      getConfig().isSetupComplete = true
      await saveConfig()
    }
  })

  return { ok: !!emitter }
}
