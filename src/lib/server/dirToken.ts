import 'server-only'

import crypto from 'node:crypto'

import { getConfig } from '@/lib/server/config'

/**
 * @module
 * # Signed directory tokens
 *
 * A signed directory token is a stateless capability granting read-only access
 * to all files under a given root directory.
 *
 * Tokens can be used to authenticate previews of project files (e.g. HTML builds)
 * in sandboxed opaque-origin iframes:
 * browsers intentionally omit SameSite cookies in sub-resource requests there.
 */

/** How soon after being minted will the token expire. */
const TTL_MS = 6 * 60 * 60 * 1000

function secret(): string {
  const secret = getConfig().authSessionSecret
  if (!secret) throw new Error('authSessionSecret is not set')
  return secret
}

function hmac(payload: string): string {
  return crypto
    .createHmac('sha256', secret())
    .update('signed-dir:' + payload)
    .digest('hex')
}

/** Mint a token granting read access to files under {@link rootDir} for {@link TTL_MS}. */
export function mintSignedDirToken(rootDir: string): string {
  // Three dot-separated parts (base64url.digits.hex). No `/` ever appears in the token.
  const payload = `${Buffer.from(rootDir).toString('base64url')}.${Date.now() + TTL_MS}`
  return `${payload}.${hmac(payload)}`
}

/** Return the root directory that {@link token} grants access to,
 * or `null` if the token is invalid or expired. */
export function verifySignedDirToken(token: string): string | null {
  const parts = token.split('.')
  const [rootDirB64, exp, sig, ...rest] = parts
  if (rootDirB64 === undefined || exp === undefined || sig === undefined || rest.length != 0) return null
  const expected = hmac(`${rootDirB64}.${exp}`)
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return null
  }
  if (Number(exp) <= Date.now()) return null
  return Buffer.from(rootDirB64, 'base64url').toString()
}

/** URL at which Nginx serves {@link relPath}, a path relative to {@link token}'s root. */
export function signedDirFileUrl(token: string, relPath: string): string {
  return `/_file/${token}/${relPath.split('/').map(encodeURIComponent).join('/')}`
}
