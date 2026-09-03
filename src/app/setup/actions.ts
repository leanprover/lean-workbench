'use server'

import { getDataDir } from '@leanprover/workbench-shared/node'
import path from 'path'
import z from 'zod'

import { requireAdmin } from '@/lib/server/auth'
import { getConfig, isDevMode, saveConfig } from '@/lib/server/config'
import { startTrackedCommand } from '@/lib/server/trackedCommand'
import { submitAction } from '@/lib/server/util'
import { type ActionResponse } from '@/lib/util'

export const doSeed = submitAction(
  z.object({ baseUrl: z.string(), installToolchain: z.boolean().optional() }),
  async ({ baseUrl, installToolchain }): Promise<ActionResponse<boolean>> => {
    await requireAdmin()

    const cfg = getConfig()
    if (cfg.isSetupComplete) return { error: 'Already seeded' }
    if (cfg.baseUrl !== baseUrl) {
      if (isDevMode()) {
        cfg.baseUrl = baseUrl
        await saveConfig()
      } else {
        return { error: `Server is configured to run on ${cfg.baseUrl}, but is being accessed via ${baseUrl}` }
      }
    }

    const scriptsDir = path.join(process.cwd(), 'scripts') // scripts/ is a sibling directory
    const scriptsArgs = ['--data-dir', getDataDir()]
    if (installToolchain) scriptsArgs.push('--install-toolchain')
    const emitter = startTrackedCommand('seed', path.join(scriptsDir, 'seed-volume.sh'), scriptsArgs)

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
  },
)
