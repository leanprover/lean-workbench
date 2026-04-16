import { ActionResponse } from '@/lib/util'
import { spawn } from 'node:child_process'
import path from 'node:path'
import 'server-only'
import { getConfig, saveConfig } from './config'

export interface SeedEvent {
  type: 'log' | 'progress' | 'done' | 'error'
  line?: string
  step?: number
  total?: number
  label?: string
  message?: string
}

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

export function startSeed(): ActionResponse<boolean> {
  const cfg = getConfig()
  if (cfg.isSetupComplete) return { error: 'Already seeded' }
  if (!cfg.githubAuth) return { error: 'Configure GitHub authentication first' }
  if (seedState.inProgress) return { error: 'Seeding already in progress' }

  seedState.inProgress = true
  seedState.events.length = 0

  // scripts/ is a sibling directory
  const scriptsDir = path.join(process.cwd(), 'scripts')

  const child = spawn('bash', [path.join(scriptsDir, 'seed-volume.sh'), '--data-dir', cfg.dataDir], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  function processLine(line: string) {
    if (!line) return
    const m = PROGRESS_RE.exec(line)
    if (m) {
      seedState.events.push({ type: 'progress', step: parseInt(m[1]), total: parseInt(m[2]), label: m[3] })
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

  child.on('close', code => {
    if (code === 0) {
      cfg.isSetupComplete = true
      saveConfig()
      seedState.events.push({ type: 'done' })
    } else {
      seedState.events.push({ type: 'error', message: `seed-volume.sh exited with code ${code}` })
    }
    seedState.inProgress = false
  })

  return { ok: true }
}
