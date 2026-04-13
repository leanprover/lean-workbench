import { getRequestEvent } from '$app/server'
import { env } from '$env/dynamic/private'
import { getConfig, isGithubEnabled } from '$lib/server/config'
import { getDb } from '$lib/server/db'
import { betterAuth, type SocialProviders } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { sveltekitCookies } from 'better-auth/svelte-kit'

function createAuth() {
  const config = getConfig()
  const socialProviders: SocialProviders = {}
  if (isGithubEnabled(config)) {
    socialProviders.github = {
      clientId: config.githubClientId,
      clientSecret: config.githubClientSecret,
    }
  }
  return betterAuth({
    baseURL: env.ORIGIN,
    // Trust both HTTP and HTTPS in dev mode; reverse proxy causes issues otherwise.
    trustedOrigins: config.isDevMode
      ? [env.ORIGIN.replace('https:', 'http:'), env.ORIGIN.replace('http:', 'https:')]
      : [],
    database: prismaAdapter(getDb(), { provider: 'sqlite' }),
    // Email authentication in dev mode only
    emailAndPassword: {
      enabled: config.isDevMode,
      minPasswordLength: 1,
    },
    plugins: [sveltekitCookies(getRequestEvent)],
    socialProviders,
    user: {
      additionalFields: {
        isAdmin: {
          type: 'boolean',
          required: true,
          defaultValue: false,
          input: false,
        },
        // NOTE: non-scalar fields cannot be encoded here.
        // We read them via Prisma when needed.
      }
    }
  })
}

export type AuthInstance = ReturnType<typeof createAuth>
export type Session = AuthInstance['$Infer']['Session']['session']
export type User = AuthInstance['$Infer']['Session']['user']

let auth: AuthInstance | null = null

export function initAuth(): AuthInstance {
  auth = createAuth()
  return auth
}

export function getAuth(): AuthInstance {
  if (auth) return auth
  return initAuth()
}