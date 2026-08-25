import 'server-only'

import { getDataDir } from '@leanprover/workbench-shared/node'
import chokidar, { type FSWatcher } from 'chokidar'
import fs from 'fs'
import path from 'path'
import z from 'zod'

// --- Configuration ---

export function isDevMode(): boolean {
  return process.env.NODE_ENV !== 'production'
}

const zRegistrationMode = z.enum(['open', 'restricted'])

export type RegistrationMode = z.infer<typeof zRegistrationMode>

export const zGithubAuthConfig = z.object({
  clientId: z.string('Client ID is required').trim().min(1, 'Client ID is required'),
  clientSecret: z.string('Client secret is required').trim().min(1, 'Client secret is required'),
})

export type GithubAuthConfig = z.infer<typeof zGithubAuthConfig>

const zServerConfig = z.object({
  registrationMode: zRegistrationMode.default('open'),
  isSetupComplete: z.boolean(),
  githubAuth: zGithubAuthConfig.optional(),
  /** 256 random bits, hex-encoded as a 512-bit string. */
  authSessionSecret: z.string().optional(),
  /** The scheme, hostname, and port through which the browser will access our server.
   * Requests made through other URLs may misbehave,
   * e.g. better-auth will reject authentication requests. */
  baseUrl: z.url(),
  /** A pre-generated admin password,
   * changed immediately during initial setup. */
  initAdminPassword: z.string().length(24).optional(),
})

/** Server configuration. Also stored on-disk in `$LEAN_WORKBENCH_DATA_DIR/config.json`. */
type ServerConfig = z.infer<typeof zServerConfig>

const defaults: ServerConfig = {
  registrationMode: 'open',
  isSetupComplete: false,
  baseUrl: 'http://localhost:3000',
}

/** Whether GitHub OAuth is set up. */
export function hasGithubAuth(cfg: ServerConfig): cfg is ServerConfig & { githubAuth: GithubAuthConfig } {
  return !!cfg.githubAuth
}

function getConfigPath(): string {
  return path.join(getDataDir(), 'config.json')
}

/** Load configuration from disk. Store in `g.__config`. */
function loadConfig() {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(getConfigPath(), 'utf-8'))
    const diskData = zServerConfig.partial().parse(raw)
    g.__config = { ...defaults, ...diskData }
  } catch (e: unknown) {
    throw new Error(`Failed to parse config.json: ${String(e)}`, { cause: e })
  }
}

function writeConfig() {
  const config = g.__config
  if (!config) {
    throw new Error('Tried to save config before initializing it.')
  }
  fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), 'utf-8')
}

/** Save configuration to disk. */
export async function saveConfig() {
  // Stop the watcher across our own write so the change event doesn't bounce back.
  await g.__configWatcher?.close()
  g.__configWatcher = undefined
  writeConfig()
  ensureConfigWatcher()
}

/** Watch config.json for external changes and reload the in-memory cache. */
function ensureConfigWatcher() {
  if (g.__configWatcher) return
  g.__configWatcher = chokidar
    .watch(getConfigPath(), {
      ignoreInitial: true,
      awaitWriteFinish: true,
    })
    .on('change', () => {
      try {
        loadConfig()
        console.log('Reloaded config')
      } catch (e: unknown) {
        console.error(`Failed to reload config: ${String(e)}`)
      }
    })
  // FIXME: reinit auth; general reactivity (nanostores?).
}

/** Return the server configuration.
 *
 * The object may be mutated. `saveConfig()` must be called after any modifications. */
export function getConfig(): ServerConfig {
  if (!g.__config) initConfig()
  return g.__config!
}

export function initConfig() {
  if (g.__config) throw new Error('internal error: attempted to reinitialize config module')
  if (!fs.existsSync(getConfigPath())) {
    g.__config = { ...defaults }
    writeConfig()
  } else {
    loadConfig()
  }
  ensureConfigWatcher()
}

const g = globalThis as typeof globalThis & {
  __config?: ServerConfig
  __configWatcher?: FSWatcher
}
