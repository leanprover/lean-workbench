import { type ChildProcess, spawn } from 'node:child_process'
import path from 'node:path'
import { getConfig, saveConfig } from './config.js'

export interface SeedEvent {
  type: 'progress' | 'log' | 'done' | 'error'
  step?: number
  total?: number
  label?: string
  line?: string
  message?: string
}

const PROGRESS_RE = /^\[progress (\d+)\/(\d+) (.+)\]$/

let seedingInProgress = false
let seedEvents: SeedEvent[] = []

export function isSeedingInProgress(): boolean {
  return seedingInProgress
}

export function getSeedEvents(): SeedEvent[] {
  return seedEvents
}

export function startSeeding(): void {
  const cfg = getConfig()
  if (cfg.isSetupComplete) {
    throw new Error('Already seeded')
  }
  if (!cfg.githubClientId || !cfg.githubClientSecret) {
    throw new Error('Configure authentication first')
  }
  if (seedingInProgress) {
    throw new Error('Seeding already in progress')
  }

  seedingInProgress = true
  seedEvents = []

  const scriptsDir = path.join(import.meta.dirname, '..', '..', '..', '..', '..', 'scripts')
  const child: ChildProcess = spawn('bash', [path.join(scriptsDir, 'seed-volume.sh'), '--root', cfg.dataDir], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  function processLine(line: string) {
    if (!line) return
    const m = PROGRESS_RE.exec(line)
    if (m) {
      seedEvents.push({ type: 'progress', step: parseInt(m[1]), total: parseInt(m[2]), label: m[3] })
    } else {
      seedEvents.push({ type: 'log', line })
    }
  }

  child.stdout?.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString().split('\n')) processLine(line)
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString().split('\n')) processLine(line)
  })

  child.on('close', code => {
    seedingInProgress = false
    if (code === 0) {
      cfg.isSetupComplete = true
      saveConfig()
      seedEvents.push({ type: 'done' })
    } else {
      seedEvents.push({ type: 'error', message: `seed-volume.sh exited with code ${code}` })
    }
  })

}
