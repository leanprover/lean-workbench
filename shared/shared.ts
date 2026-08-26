import { z } from 'zod'

/*
 * # Data validation
 *
 * - IDs are used in file paths and in URLs.
 *   They must never contain traversal characters (`/` and `.`).
 *   Project and user IDs are currently required to be UUID v4.
 * - Project names are not used in file paths, but may be used in URLs.
 *   We enforce alphanumeric ASCII names.
 *   Names are unique up to recasing, natively in the database (`COLLATE NOCASE`).
 *   Unicode names may be added in the future.
 */

/** String representation of a RFC 4122 UUID v4. */
export const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export const ALPHANUM_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/
export const TEMPLATE_ID_RE = /^[a-zA-Z0-9_-]+$/

export const zUserId = z.string().regex(UUID_V4_RE, 'Invalid user ID')
export const zUserName = z.string().regex(ALPHANUM_NAME_RE, 'Invalid user name')
export const zValidateUserName = z.string('User name required').trim().regex(ALPHANUM_NAME_RE, 'Invalid user name')

export const zProjectId = z.string().regex(UUID_V4_RE, 'Invalid project ID')
export const zProjectName = z.string().regex(ALPHANUM_NAME_RE, 'Invalid project name')
export const zValidateProjectName = z
  .string('Project name required')
  .trim()
  .regex(ALPHANUM_NAME_RE, 'Invalid project name')
export const zTemplateId = z.string().regex(TEMPLATE_ID_RE, 'Invalid template ID')

export const LEAN_VERSION_RE = /^v4\.\d+\.\d+(-rc\d+)?$/

/** Metadata of a Lean Workbench project workspace. */
export type WorkspaceMetadata = z.infer<typeof zWorkspaceMetadata>

/** Validator for {@link WorkspaceMetadata} */
export const zWorkspaceMetadata = z.object({
  /** Scheme, host, and port through which the browser reaches the workbench. */
  baseUrl: z.url(),
  /** User viewing/editing the current project. */
  viewer: z.object({
    name: z.string(),
    image: z.nullish(z.string()),
  }),
  /** Metadata about the current project. */
  project: z.object({
    name: z.string(),
    owner: z.object({
      name: z.string(),
    }),
  }),
  /** Files that should be synced collaboratively across viewers.
   * Patterns are matched with minimatch. */
  syncPatterns: z.array(z.string()),
  /** Files that should be excluded from collaborative sync.
   * Patterns are matched with minimatch. */
  excludeSyncPatterns: z.array(z.string()).optional(),
})

/** We keep a Y.Doc per collaboratively-editable file.
 * This is the Y.Doc key under which the text content lives. */
export const YTEXT_KEY = 'content'

/** Name of the `collab-server` database file. */
export const COLLAB_DB_FILENAME = 'collab.db'

/** Name of the `collab-server` UDS file. */
export const COLLAB_SOCKET_FILENAME = 'collab.sock'

/**
 * Where bwrap mounts the given project directory.
 * We identify project files by absolute path in Yjs,
 * so this has to match across VS Code server and collab-server bwraps.
 */
export function bwrapProjectDir(projectName: string) {
  return `/workspace/${projectName}/`
}

/** Path to workspace metadata file in VSCode bwraps. */
export const BWRAP_METADATA_PATH = '/workspace/.lean-workbench.json'

/** Working directory of collab-server in the VSCode and collab-server bwraps. */
export const BWRAP_COLLAB_SERVER_DIR = '/workspace/.collab-server'

/** Collab-server socket path in the VSCode and collab-server bwraps. */
export const BWRAP_COLLAB_SOCK_PATH = `${BWRAP_COLLAB_SERVER_DIR}/${COLLAB_SOCKET_FILENAME}`

/** Pseudo-email for the admin user */
export const adminEmail = 'admin@admin.localhost'

/** Minimum password length for admin user */
export const MIN_ADMIN_PASSWORD_LENGTH = 8

/** Pseudo-email for dev users. 1 is `dev@dev.localhost`, subsequent is `devN@dev.localhost` */
export const devModeEmail = (n: number) => `dev${n > 1 ? String(n) : ''}@dev.localhost`

/**
 * Dev password, used both as the password for the dev user,
 * and as the initAdminPassword in dev mode.
 */
export const devModePassword = 'dev'
