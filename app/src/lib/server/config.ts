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

const zConfigDiskData = z.object({
  registrationMode: zRegistrationMode,
  isSetupComplete: z.boolean(),
  githubAuth: zGithubAuthConfig.optional(),
})

type ConfigDiskData = z.infer<typeof zConfigDiskData>

const defaults: ConfigDiskData = {
  registrationMode: 'open',
  isSetupComplete: false,
}

/** Server configuration. */
export interface Config extends ConfigDiskData {
  dataDir: string
}

/** Whether GitHub OAuth is set up. */
export function hasGithubAuth(cfg: Config): cfg is Config & { githubAuth: GithubAuthConfig } {
  return !!cfg.githubAuth
}

export function isDevMode(): boolean {
  return process.env.NODE_ENV !== 'production'
}

const g = globalThis as typeof globalThis & {
  /** Initialized lazily in {@link getConfig}. */
  __config?: Config
}

/** Return the server configuration, reading it from disk the first time.
 *
 * The object may be mutated. `saveConfig()` must be called after any modifications. */
export function getConfig(): Config {
  if (g.__config) return g.__config
  if (!process.env.LEAN_WORKBENCH_DATA_DIR) {
    throw new Error('Environment variable LEAN_WORKBENCH_DATA_DIR must be set.')
  }
  const dataDir = path.resolve(process.env.LEAN_WORKBENCH_DATA_DIR)
  if (!fs.existsSync(dataDir)) {
    throw new Error('Directory specified in LEAN_WORKBENCH_DATA_DIR does not exist.')
  }
  const configPath = path.join(dataDir, 'config.json')
  if (!fs.existsSync(configPath)) {
    g.__config = { ...defaults, dataDir }
    saveConfig()
  } else {
    try {
      const raw: unknown = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      const diskData = zConfigDiskData.partial().parse(raw)
      g.__config = { ...defaults, ...diskData, dataDir }
    } catch (e: unknown) {
      throw new Error(`Failed to parse config.json: ${String(e)}`, { cause: e })
    }
  }
  return g.__config
  // FIXME: config.json watcher
}

/** Save configuration to disk. */
export function saveConfig() {
  const config = g.__config
  if (!config) {
    throw new Error('Tried to save config before initializing it.')
  }
  const configPath = path.join(config.dataDir, 'config.json')
  const diskData: ConfigDiskData = {
    registrationMode: config.registrationMode,
    isSetupComplete: config.isSetupComplete,
    githubAuth: config.githubAuth,
  }
  fs.writeFileSync(configPath, JSON.stringify(diskData, null, 2), 'utf-8')
}
