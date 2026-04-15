import 'server-only'
import { getConfig, hasGithubAuth, isDevMode } from '@/lib/server/config'
import { getDb } from '@/lib/server/db'
import { betterAuth, type SocialProviders } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { nextCookies } from 'better-auth/next-js'

function createAuth() {
  const config = getConfig()
  const socialProviders: SocialProviders = {}
  if (hasGithubAuth(config)) {
    // FIXME: middleware to check db for allowed usernames
    socialProviders.github = {
      clientId: config.githubAuth.clientId,
      clientSecret: config.githubAuth.clientSecret,
    }
  }
  return betterAuth({
    database: prismaAdapter(getDb(), { provider: 'sqlite' }),
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
      },
    },
    // Email authentication in dev mode only
    emailAndPassword: {
      enabled: isDevMode(),
      minPasswordLength: 1,
    },
    socialProviders,
    // baseURL: process.env.ORIGIN,
    // FIXME: Trust both HTTP and HTTPS in dev mode; reverse proxy causes issues otherwise.
    // trustedOrigins: config.isDevMode
    //   ? [env.ORIGIN.replace('https:', 'http:'), env.ORIGIN.replace('http:', 'https:')]
    //   : [],
    plugins: [nextCookies()],
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
