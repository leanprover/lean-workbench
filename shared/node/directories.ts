import fs from 'node:fs'
import path from 'node:path'

// --- Directories ---

/**
 * Not exported, must match the pattern of the inferred Prisma User type
 * (The fields `name`, `email`, and `emailVerified` are only here to make it
 * less likely we'll duck-type the wrong thing as a User.)
 */
type User = { id: string; name: string; email: string; emailVerified: boolean }

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

export function getUserRootDir(user: User): string {
  return path.join(getWorkspacesDir(), user.id)
}

/** The given user's persistent home directory, used as `$HOME` in their editor sandboxes. */
export function getUserHomeDir(user: User): string {
  return path.join(getWorkspacesDir(), user.id, 'home')
}

/** The given project's data directory.*/
export function getProjectDir(user: User, projectId: string): string {
  return path.join(getWorkspacesDir(), user.id, projectId)
}

/** Root of the built publications served from the publish origin. */
export function getPublicationsDir(): string {
  return path.join(getDataDir(), 'publications')
}

/** The directory whose contents are served for the given publication. */
export function getPublicationDir(publicationId: string): string {
  return path.join(getPublicationsDir(), publicationId)
}

/** Where a publish build writes before its output is swapped into place.
 * Named after the project because a publication id is only minted once a build has succeeded.
 * The leading `.` keeps it out of the publication id namespace. */
export function getPublishStagingDir(projectId: string, kind: string): string {
  return path.join(getPublicationsDir(), '.staging', `${projectId}-${kind}`)
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

/** Scripts that the workbench runs, both on the host and inside sandboxes. */
export function getScriptsDir(): string {
  return path.join(process.cwd(), 'scripts')
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
