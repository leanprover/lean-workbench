import fs from 'node:fs'
import path from 'node:path'

// --- Directories ---

export function getDataDir(): string {
  if (!process.env.LEAN_WORKBENCH_DATA_DIR) {
    throw new Error('Environment variable LEAN_WORKBENCH_DATA_DIR must be set.')
  }
  const dataDir = path.resolve(process.env.LEAN_WORKBENCH_DATA_DIR)
  if (!fs.existsSync(dataDir)) {
    throw new Error(`Directory specified in LEAN_WORKBENCH_DATA_DIR="${dataDir}" does not exist.`)
  }
  return dataDir
}

export function getWorkspacesDir(): string {
  return path.join(getDataDir(), 'workspaces')
}

/** The given user's persistent home directory, used as `$HOME` in their editor sandboxes. */
export function getUserHomeDir(userName: string): string {
  return path.join(getWorkspacesDir(), userName, 'home')
}

/** The given project's data directory.*/
export function getProjectDir(userName: string, projectId: string): string {
  return path.join(getWorkspacesDir(), userName, projectId)
}

export function getTemplatesDir(): string {
  return path.join(getDataDir(), 'templates')
}

export function getPackageSetsDir(): string {
  return path.join(getDataDir(), 'package-sets')
}

export function getDbDir(): string {
  return path.join(getDataDir(), 'db')
}

export function getElanDir(): string {
  return path.join(getDataDir(), 'elan')
}

export function getOpenVscodeServerDir(): string {
  return process.env.VSCODE_SERVER_DIR ?? '/app/vscode-server'
}

export function getWorkbenchDir(): string {
  return '/app/workbench'
}

export function getCollabServerDir(): string {
  return path.join(getWorkbenchDir(), 'collab-server')
}

export function getNginxConfDir(): string {
  return process.env.NGINX_CONF_DIR ?? '/etc/nginx'
}

export function getNginxLogDir(): string {
  return process.env.NGINX_LOG_DIR ?? '/var/log/nginx'
}
