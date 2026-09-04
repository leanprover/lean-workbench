import { getConfig, isDevMode } from './config'

/**
 * Make a GET request to GitHub's API using the application's OAuth App configuration.
 *
 * Calling `githubAPI('/rate_limit')` will access the endpoint documented at
 * <https://docs.github.com/en/rest/rate-limit/rate-limit?apiVersion=2026-03-10#get-rate-limit-status-for-the-authenticated-user>.
 *
 * If the GitHub OAuth App is not configured, this will throw an error in production.
 */
export async function githubAPI(path: string) {
  const cfg = getConfig()
  const headers: HeadersInit = { Accept: 'application/vnd.github+json', 'X-Github-API-Version': '2026-03-10' }
  if (cfg.githubAuth) {
    const auth = Buffer.from(`${cfg.githubAuth.clientId}:${cfg.githubAuth.clientSecret}`).toString('base64')
    headers.Authorization = `Basic ${auth}`
  } else if (!isDevMode()) {
    throw new Error('Github credentials not available')
  }
  const fullPath = 'https://api.github.com' + path
  const response = await fetch(fullPath, { headers })

  if (response.status === 200) return { ok: true, response: (await response.json()) as unknown }
  if (response.headers.get('x-ratelimit-remaining') === '0') {
    const wait = Number(response.headers.get('x-ratelimit-reset')) - Date.now() / 1000
    throw new Error(`GitHub API rate limit exceeded; resets in ${wait} seconds`)
  }
  if (response.status === 401) throw new Error(`GitHub API reported invalid credentials (status 401)`)
  if (response.status === 403) throw new Error(`GitHub API access forbidden (status 403)`)
  return { ok: false, status: response.status }
}
