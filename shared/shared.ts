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

/**
 * 32-character case-sensitive alphanumeric identifiers,
 * created internally by Better-auth or via Better-auth's generateId(32).
 */
export const BETTERAUTH_ID_RE = /^[a-zA-Z0-9]{32}$/

export const ALPHANUM_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/
export const TEMPLATE_ID_RE = /^[a-zA-Z0-9_-]+$/

export const zUserId = z.string().regex(BETTERAUTH_ID_RE, 'Invalid user ID')
export const zUserName = z.string().regex(ALPHANUM_NAME_RE, 'Invalid user name')
export const zValidateUserName = z.string('User name required').trim().regex(ALPHANUM_NAME_RE, 'Invalid user name')

export const zProjectId = z.string().regex(UUID_V4_RE, 'Invalid project ID')
export const zProjectName = z.string().regex(ALPHANUM_NAME_RE, 'Invalid project name')
export const zValidateProjectName = z
  .string('Project name required')
  .trim()
  .regex(ALPHANUM_NAME_RE, 'Invalid project name')
export const zTemplateId = z.string().regex(TEMPLATE_ID_RE, 'Invalid template ID')

/**
 * Expected form of a toolchain (not necessarily exhaustive, must be command-line-argument-safe)
 * Examples: `lean4`, `leanprover/lean4:v4.32.1`, `leanprover/lean4-nightly:nightly-2026-08-27`
 */
export const EXPECTED_TOOLCHAIN_ID_RE = /^[a-z][a-z0-9:/_.-]*$/

/**
 * Expected form of a standard installed stable/beta/nightly toolchain.
 *  - If `match[1] === 'lean'`,
 *    then `match[2]` is a candidate for a tag of <https://github.com/leanprover-community/mathlib4>.
 *  - If `match[1] === 'lean4-nightly'`,
 *    then `match[2]` is a candidate for a tag of <https://github.com/leanprover-community/mathlib4-nightly-testing/>
 */
export const STANDARD_TOOLCHAIN_ID_RE = /^leanprover\/(lean4|lean4-nightly):([a-z0-9.-]+)$/

export const LEAN_STABLE_VERSION_RE = /^v4\.[0-9]+\.[0-9]+$/
export const LEAN_BETA_VERSION_RE = /^v4\.[0-9]+\.[0-9]+-rc[0-9]+$/
export const LEAN_NIGHTLY_VERSION_RE = /^nightly-[0-9-]+$/

/** Matches stable or beta Lean versions (not nightly) */
export const LEAN_VERSION_RE = /^v4\.(\d+)\.(\d+)(-rc(\d+))?$/

/**
 * Compares two lean versions matching `LEAN_VERSION_RE`.
 *
 * ```
 * leanVersionCompare("v4.1.3", "v4.32.2") < 0
 * leanVersionCompare("v4.30.4", "v4.31.0-rc1") < 0
 * leanVersionCompare("v4.31.1-rc10", "v4.31.0-rc9") > 0
 * ```
 */
export function leanVersionCompare(v1: string, v2: string) {
  const m1 = v1.match(LEAN_VERSION_RE)
  const m2 = v2.match(LEAN_VERSION_RE)
  if (!m1 || !m2) throw new Error(`Either ${v1} and/or ${v2} are not valid Lean version numbers`)
  const [primary1, primary2] = [Number(m1[1]), Number(m2[1])]
  if (primary1 !== primary2) return primary1 - primary2
  const [secondary1, secondary2] = [Number(m1[2]), Number(m2[2])]
  if (secondary1 !== secondary2) return secondary1 - secondary2
  if (!m1[4]) return m2[4] ? 1 : 0
  if (!m2[4]) return -1
  return Number(m1[4]) - Number(m2[4])
}

/**
 * Does a toolchain match STANDARD_TOOLCHAIN_ID_RE and do Lean, Mathlib, and CSLib
 * work with the lean module system at that version?
 *
 * For stable releases, returns true for v4.27.0 and beyond.
 * For nighties, very conservatively returns true in February 2026 and beyond.
 */
export function toolchainHasModules(toolchain: string) {
  const m = toolchain.match(STANDARD_TOOLCHAIN_ID_RE)
  if (!m) return false
  if (m[1] === 'lean4') {
    return LEAN_VERSION_RE.test(m[2]!) && leanVersionCompare(m[2]!, 'v4.27.0') >= 0
  }
  return LEAN_NIGHTLY_VERSION_RE.test(m[2]!) && m[2]! >= 'nightly-2026-02-01'
}

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

/** Pseudo-email for dev user number `n`. */
export const devModeEmail = (n: number) => `dev${String(n)}@dev.localhost`

/**
 * Dev password, used both as the password for the dev user,
 * and as the initAdminPassword in dev mode.
 */
export const devModePassword = 'dev'
