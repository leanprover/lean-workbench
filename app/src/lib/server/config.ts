import chokidar, { type FSWatcher } from 'chokidar'
import fs from 'fs'
import path from 'path'
import 'server-only'
import z from 'zod'

const zRegistrationMode = z.enum(['open', 'restricted'])

export type RegistrationMode = z.infer<typeof zRegistrationMode>

const zGithubAuthConfig = z.object({
  clientId: z.string(),
  clientSecret: z.string(),
})

export type GithubAuthConfig = z.infer<typeof zGithubAuthConfig>

const zServerConfig = z.object({
  registrationMode: zRegistrationMode,
  isSetupComplete: z.boolean(),
  githubAuth: zGithubAuthConfig.optional(),
})

/** Server configuration. Also stored on-disk in `$LEAN_WORKBENCH_DATA_DIR/config.json`. */
type ServerConfig = z.infer<typeof zServerConfig>

const defaults: ServerConfig = {
  registrationMode: 'open',
  isSetupComplete: false,
}

/** Whether GitHub OAuth is set up. */
export function hasGithubAuth(cfg: ServerConfig): cfg is ServerConfig & { githubAuth: GithubAuthConfig } {
  return !!cfg.githubAuth
}

export function isDevMode(): boolean {
  return process.env.NODE_ENV !== 'production'
}

export function getDataDir(): string {
  if (!process.env.LEAN_WORKBENCH_DATA_DIR) {
    throw new Error('Environment variable LEAN_WORKBENCH_DATA_DIR must be set.')
  }
  const dataDir = path.resolve(process.env.LEAN_WORKBENCH_DATA_DIR)
  if (!fs.existsSync(dataDir)) {
    throw new Error('Directory specified in LEAN_WORKBENCH_DATA_DIR does not exist.')
  }
  return dataDir
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
  g.__configWatcher = chokidar.watch(getConfigPath(), {
    ignoreInitial: true,
    awaitWriteFinish: true,
  }).on('change', () => {
    try {
      loadConfig()
    } catch (e: unknown) {
      console.error(`Failed to reload config: ${String(e)}`)
    }
  })
}

/** Return the server configuration.
 *
 * The object may be mutated. `saveConfig()` must be called after any modifications. */
export function getConfig(): ServerConfig {
  if (!g.__config) throw new Error('internal error: g.__config uninitialized')
  return g.__config
}

const g = globalThis as typeof globalThis & {
  __config?: ServerConfig
  __configWatcher?: FSWatcher
}
if (!g.__config) {
  if (!fs.existsSync(getConfigPath())) {
    g.__config = { ...defaults }
    writeConfig()
  } else {
    loadConfig()
  }
  ensureConfigWatcher()
}
}
