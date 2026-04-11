import { dev } from '$app/environment'
import { env } from '$env/dynamic/private'
import { getConfig } from '$lib/server/config'
import { getDb } from '$lib/server/db'
import { type Auth, betterAuth, type BetterAuthOptions, type SocialProviders } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'

let auth: Auth | null = null

export function getAuth(): Auth {
  if (auth) return auth
  const config = getConfig()
  const socialProviders: SocialProviders = {}
  if (config.githubClientId && config.githubClientSecret) {
    socialProviders.github = {
      clientId: config.githubClientId,
      clientSecret: config.githubClientSecret,
    }
  }
  const options: BetterAuthOptions = {
    baseURL: env.ORIGIN,
    // Trust both HTTP and HTTPS in dev mode; reverse proxy causes issues otherwise.
    trustedOrigins: dev ? [env.ORIGIN.replace('https:', 'http:'), env.ORIGIN.replace('http:', 'https:')] : [],
    database: prismaAdapter(getDb(), { provider: 'sqlite' }),
    socialProviders,
  }
  auth = betterAuth(options)
  return auth
}
