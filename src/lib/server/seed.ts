import 'server-only'

import { spawn } from 'node:child_process'
import path from 'node:path'

import { LEAN_VERSION_RE } from '@leanprover/workbench-shared'
import { getDataDir } from '@leanprover/workbench-shared/node'

import { type ActionResponse, type SeedEvent } from '@/lib/util'

import { getConfig, saveConfig } from './config'

export interface SeedState {
  inProgress: boolean
  events: SeedEvent[]
}

const PROGRESS_RE = /^\[progress (\d+)\/(\d+) (.+)\]$/

// `globalThis` ensures downstream modules see a single copy of the state.
const g = globalThis as typeof globalThis & {
  __seedState?: SeedState
}
if (!g.__seedState) g.__seedState = { inProgress: false, events: [] }
const seedState: SeedState = g.__seedState

export function getSeedState(): Readonly<SeedState> {
  return seedState
}

export function startSeed(leanVersion: string): ActionResponse<boolean> {
  const cfg = getConfig()
  if (cfg.isSetupComplete) return { error: 'Already seeded' }
  if (!cfg.githubAuth) return { error: 'Configure GitHub authentication first' }
  if (seedState.inProgress) return { error: 'Seeding already in progress' }
  if (leanVersion !== 'LATEST' && !LEAN_VERSION_RE.test(leanVersion)) return { error: 'Invalid Lean version' }

  seedState.inProgress = true
  seedState.events.length = 0

  // scripts/ is a sibling directory
  const scriptsDir = path.join(process.cwd(), 'scripts')

  const args = [path.join(scriptsDir, 'seed-volume.sh'), '--data-dir', getDataDir()]
  if (leanVersion !== 'LATEST') args.push('--lean-version', leanVersion)
  const child = spawn('bash', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  function processLine(line: string) {
    if (!line) return
    const m = PROGRESS_RE.exec(line)
    if (m) {
      seedState.events.push({ type: 'progress', step: parseInt(m[1]!), total: parseInt(m[2]!), label: m[3]! })
    } else {
      seedState.events.push({ type: 'log', line })
    }
  }

  child.stdout.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString().split('\n')) processLine(line)
  })
  child.stderr.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString().split('\n')) processLine(line)
  })

  child.on('close', async code => {
    if (code === 0) {
      cfg.isSetupComplete = true
      await saveConfig()
      seedState.events.push({ type: 'done' })
    } else {
      seedState.events.push({ type: 'error', message: `seed-volume.sh exited with code ${code}` })
    }
    seedState.inProgress = false
  })

  return { ok: true }
}
