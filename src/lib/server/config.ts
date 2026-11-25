import 'server-only'

import { getDataDir, isDevMode } from '@leanprover/workbench-shared/node'
import chokidar, { type FSWatcher } from 'chokidar'
import fs from 'fs'
import path from 'path'
import z from 'zod'

// --- Configuration ---

const zRegistrationMode = z.enum(['open', 'restricted'])

export type RegistrationMode = z.infer<typeof zRegistrationMode>

export const zGitHubAuthConfig = z.object({
  clientId: z.string('Client ID is required').trim().min(1, 'Client ID is required'),
  clientSecret: z.string('Client secret is required').trim().min(1, 'Client secret is required'),
})

export type GitHubAuthConfig = z.infer<typeof zGitHubAuthConfig>

const zServerConfig = z.object({
  registrationMode: zRegistrationMode.default('open'),
  isSetupComplete: z.boolean(),
  githubAuth: zGitHubAuthConfig.optional(),
  /** 256 random bits, hex-encoded as a 512-bit string. */
  authSessionSecret: z.string().optional(),
  /** The scheme, hostname, and port through which the browser will access our server.
   * Requests made through other URLs may misbehave,
   * e.g. better-auth will reject authentication requests. */
  baseUrl: z.url(),
  /** Deprecated: origin from which publications are served.
   * This must be `${baseUrl.protocol}//pub.${baseUrl.host}` if it exists or loading will fail. */
  pubBaseUrl: z.url().optional(),
  /** Does this Workbench instance enable the publication feature? (Default false.) */
  isPublishingEnabled: z.boolean().optional(),
  /** Does this Workbench instance enable users to list projects as 'public' so that they can be viewed and edited by all users? (Default true.) */
  isPublicProjectSharingEnabled: z.boolean().optional(),
  /** Limit to how many publish builds may be in flight across the whole server. */
  maxConcurrentPublishBuilds: z.int().positive().default(2),
  /** A pre-generated admin password,
   * changed immediately during initial setup. */
  initAdminPassword: z.string().length(24).optional(),
})

/** Server configuration. Also stored on-disk in `$LEAN_WORKBENCH_DATA_DIR/config.json`. */
export type ServerConfig = z.infer<typeof zServerConfig>

const defaults: ServerConfig = {
  registrationMode: 'open',
  isSetupComplete: false,
  // isPublishingEnabled is set to !!pubBaseUrl || isDevMode() in `loadConfig()`
  isPublicProjectSharingEnabled: true,
  baseUrl: 'http://workbench.localhost:3000',
  maxConcurrentPublishBuilds: 2,
}

/** Whether publications are enabled */
export function isPublishingEnabled(cfg: ServerConfig) {
  return !!cfg.isPublishingEnabled
}

/** Whether GitHub OAuth is set up. */
export function hasGitHubAuth(cfg: ServerConfig): cfg is ServerConfig & { githubAuth: GitHubAuthConfig } {
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
    const config = { ...defaults, ...diskData }

    if (isDevMode() && config.baseUrl.includes('http://localhost:')) {
      throw new Error(`Dev: change 'localhost' in config.json to 'workbench.localhost'.`)
    }

    const baseUrl = new URL(config.baseUrl) // Throws if baseUrl is not a valid URL
    if (!URL.canParse(`${baseUrl.protocol}//subdomain.${baseUrl.host}`)) {
      throw new Error(
        `Workbench's base URL requires ${baseUrl.protocol}//subdomain.${baseUrl.host} to also be a valid URL.`,
      )
    }

    let migrated = false
    if (config.isPublishingEnabled === undefined) {
      // Allow publication if there was a previous pubBaseUrl that has the correct shape
      if (config.pubBaseUrl) {
        const pubUrl = new URL(config.pubBaseUrl)
        if (pubUrl.href !== `${baseUrl.protocol}//pub.${baseUrl.host}/`) {
          throw new Error(
            `pubBaseUrl of ${config.pubBaseUrl} is unsupported for a baseUrl of ${config.baseUrl}. Remove 'pubBaseUrl' from config.json and set '"publishingEnabled": true' to publish on pub.${baseUrl.host}.`,
          )
        }
        config.isPublishingEnabled = true
        delete config.pubBaseUrl
        migrated = true
      } else {
        config.isPublishingEnabled = false
        migrated = true
      }
    }

    g.__config = config
    if (migrated) writeConfig()
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
    if (!isDevMode()) throw new Error('starting production with no config.json')
    g.__config = { ...defaults, isPublishingEnabled: true }
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
