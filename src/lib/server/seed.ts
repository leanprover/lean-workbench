import 'server-only'

import { spawn } from 'node:child_process'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { EventEmitter } from 'node:stream'

import { LEAN_VERSION_RE } from '@leanprover/workbench-shared'
import { getDataDir } from '@leanprover/workbench-shared/node'

import { type ActionResponse } from '@/lib/util'

import { getConfig, saveConfig } from './config'
import { type CommandEvents, startStreamingCommand } from './stream'

export function startSeed(leanVersion: string | undefined): ActionResponse<boolean> {
  const cfg = getConfig()
  if (cfg.isSetupComplete) return { error: 'Already seeded' }
  if (!cfg.githubAuth) return { error: 'Configure GitHub authentication first' }
  if (leanVersion && !LEAN_VERSION_RE.test(leanVersion)) return { error: 'Invalid Lean version' }

  const emitter = startStreamingCommand('seed', () => getSeedEmitter(leanVersion))
  if (!emitter) return { error: 'Seeding already in progress' }
  emitter.on('done', async () => {
    getConfig().isSetupComplete = true
    await saveConfig()
  })

  return { ok: true }
}

function getSeedEmitter(leanVersion: string | undefined) {
  // scripts/ is a sibling directory
  const scriptsDir = path.join(process.cwd(), 'scripts')

  const args = [path.join(scriptsDir, 'seed-volume.sh'), '--data-dir', getDataDir()]
  if (leanVersion) args.push('--lean-version', leanVersion)
  const child = spawn('bash', args, { stdio: ['ignore', 'pipe', 'pipe'] })
  const emitter = new EventEmitter<CommandEvents>()

  createInterface({ input: child.stdout, crlfDelay: Infinity }).on('line', line => emitter.emit('log', line))
  createInterface({ input: child.stderr, crlfDelay: Infinity }).on('line', line => emitter.emit('log', line))

  let errorSent = false
  child.on('error', err => {
    emitter.emit('error', `seed-volume.sh generated an error: ${err.message}`)
    errorSent = true
  })
  child.on('close', code => {
    if (code === 0) {
      emitter.emit('done')
    } else if (!errorSent) {
      emitter.emit('error', `seed-volume.sh exited with code ${code}`)
    }
  })

  return emitter
}
