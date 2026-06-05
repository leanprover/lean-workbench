import z from 'zod'

/** Server actions respond with data of this shape. */
export type ActionResponse<T = void> = { ok: T } | { error: string }

/*
 * # Data validation
 *
 * - IDs are used in file paths and in URLs.
 *   They must never contain traversal characters (`/` and `.`).
 *   Project and user IDs are currently required to be UUID v4.
 * - Names are not used in file paths, but may be used in URLs.
 *   We enforce alphanumeric ASCII names that are unique up to recasing.
 *   Zod parsers apply normalization so that client input is parsed into the expected form.
 *   Unicode names may be added in the future.
 */

/** String representation of a RFC 4122 UUID v4. */
export const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export const ALPHANUM_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/
export const TEMPLATE_ID_RE = /^[a-zA-Z0-9_-]+$/

/** Canonicalize a name so that names are unique up to recasing. */
// Names are ASCII per ALPHANUM_NAME_RE, so `toLowerCase` suffices.
export const normalizeName = (s: string) => s.toLowerCase()

export const zUserId = z.string().regex(UUID_V4_RE, 'Invalid user ID')
export const zUserName = z.string().regex(ALPHANUM_NAME_RE, 'Invalid user name').transform(normalizeName)
export const zProjectId = z.string().regex(UUID_V4_RE, 'Invalid project ID')
export const zProjectName = z.string().regex(ALPHANUM_NAME_RE, 'Invalid project name').transform(normalizeName)
export const zTemplateId = z.string().regex(TEMPLATE_ID_RE, 'Invalid template ID')

export const LEAN_VERSION_RE = /^v4\.\d+\.\d+(-rc\d+)?$/
