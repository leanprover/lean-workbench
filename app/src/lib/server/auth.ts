import { getConfig, hasGithubAuth, isDevMode } from '@/lib/server/config'
import { getDb } from '@/lib/server/db'
import { betterAuth, type SocialProviders } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { nextCookies } from 'better-auth/next-js'
import 'server-only'

function createAuth() {
  const config = getConfig()
  const socialProviders: SocialProviders = {}

  if (hasGithubAuth(config)) {
    socialProviders.github = {
      clientId: config.githubAuth.clientId,
      clientSecret: config.githubAuth.clientSecret,
      mapProfileToUser: profile => {
        return {
          // `better-auth` stores the display name (`profile.name`) in `name` by default.
          name: profile.login,
          displayName: profile.name,
        }
      },
    }
  }

  return betterAuth({
    database: prismaAdapter(getDb(), { provider: 'sqlite' }),
    databaseHooks: {
      user: {
        create: {
          before: async user => {
            if (getConfig().registrationMode === 'restricted') {
              const allowed = await getDb().allowedGithubUser.findUnique({
                where: { githubUsername: user.name },
              })
              if (!allowed) {
                return false
              }
            }
          },
        },
      },
    },
    user: {
      additionalFields: {
        isAdmin: {
          type: 'boolean',
          required: true,
          defaultValue: false,
          input: false,
        },
        displayName: {
          type: 'string',
          required: false,
          input: true,
        },
        // NOTE: non-scalar fields cannot be encoded here.
        // We read them via Prisma when needed.
      },
    },
    // Email authentication in dev mode only
    // NOTE: if ever enabled in prod, make sure to clean up dev accounts with known passwords.
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
    onAPIError: {
      // Redirect to root with an error search param if something goes wrong,
      // e.g. the GitHub username is not on the allowlist.
      errorURL: '/',
    },
    plugins: [nextCookies()],
  })
}

export type AuthInstance = ReturnType<typeof createAuth>
export type Session = AuthInstance['$Infer']['Session']['session']
export type User = AuthInstance['$Infer']['Session']['user']

const g = globalThis as typeof globalThis & {
  __auth?: AuthInstance
}

export function initAuth(): AuthInstance {
  g.__auth = createAuth()
  return g.__auth
}

export function getAuth(): AuthInstance {
  if (g.__auth) return g.__auth
  return initAuth()
}
