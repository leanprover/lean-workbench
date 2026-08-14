import 'server-only'

import { betterAuth, type SocialProviders } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { hashPassword } from 'better-auth/crypto'
import { nextCookies } from 'better-auth/next-js'
import crypto, { randomUUID } from 'crypto'
import { io } from 'next/cache'
import { headers } from 'next/headers'
import { unauthorized } from 'next/navigation'

import { getConfig, hasGithubAuth, isDevMode, saveConfig } from '@/lib/server/config'
import { getDb } from '@/lib/server/db'
import { provisionUserHome } from '@/lib/server/user'
import { zUserName } from '@/lib/util'

async function createAuth() {
  const config = getConfig()
  const socialProviders: SocialProviders = {}

  if (hasGithubAuth(config)) {
    socialProviders.github = {
      clientId: config.githubAuth.clientId,
      clientSecret: config.githubAuth.clientSecret,
      mapProfileToUser: profile => {
        return {
          // `better-auth` stores the display name (`profile.name`) in `name` by default;
          // we store the username instead.
          name: profile.login,
          displayName: profile.name,
        }
      },
    }
  }

  if (!config.authSessionSecret) {
    console.log('Generating new authentication session secret..')
    config.authSessionSecret = crypto.randomBytes(32).toString('hex')
    await saveConfig()
  }

  const auth = betterAuth({
    database: prismaAdapter(getDb(), { provider: 'sqlite' }),
    secret: config.authSessionSecret,
    databaseHooks: {
      user: {
        create: {
          before: async user => {
            const parsed = zUserName.safeParse(user.name)
            if (!parsed.success) return false
            const name = parsed.data
            if (getConfig().registrationMode === 'restricted') {
              const allowed = await getDb().allowedGithubUser.findUnique({
                where: { githubUsername: name },
              })
              if (!allowed) return false
            }
            return { data: { ...user, name } }
          },
          after: async user => {
            try {
              await provisionUserHome(user as User)
            } catch (err) {
              console.error(`Failed to provision home directory for user '${user.name}': ${String(err)}`)
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
    // Email authentication
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      // Email accounts can only be created by direct DB access
      disableSignUp: true,
    },

    socialProviders,
    baseURL: config.baseUrl,
    trustedOrigins: isDevMode()
      ? /* allow anything in dev mode */ req => [req?.headers.get('origin')]
      : /* require the baseUrl from config.baseUrl */ [config.baseUrl],
    onAPIError: {
      // Redirect to root with an error search param if something goes wrong,
      // e.g. the GitHub username is not on the allowlist.
      errorURL: '/',
    },
    plugins: [nextCookies()],
  })

  return auth
}

/** Add a user with email-and-password authentication by directly modifying the database.
 * Return `true` if added, `false` if a user with this {@link name} or {@link email} already exists.
 *
 * Relies on implementation details of better-auth.
 * Needed because better-auth exposes no authentication-free way to modify accounts. */
async function addEmailPasswordUser(name: string, email: string, password: string, isAdmin: boolean): Promise<boolean> {
  const db = getDb()
  const hashedPassword = await hashPassword(password)
  return db.$transaction(async tx => {
    const [byName, byEmail] = await Promise.all([
      tx.user.findUnique({ where: { name } }),
      tx.user.findUnique({ where: { email } }),
    ])
    if (byName || byEmail) return false

    const userId = randomUUID()
    await tx.user.create({ data: { id: userId, name, email, isAdmin } })
    const accountId = randomUUID()
    await tx.account.create({
      data: {
        id: accountId,
        userId,
        accountId: userId /* better-auth convention */,
        providerId: 'credential',
        password: hashedPassword,
      },
    })
    return true
  })
}

/** Ensures that an admin account exists,
 * and that a non-admin dev account exists iff we are in dev mode. */
async function ensureBuiltinUsersExist() {
  const adminEmail = 'admin@admin.localhost'
  const db = getDb()
  if (!(await db.user.findUnique({ where: { email: adminEmail } }))) {
    let { initAdminPassword } = getConfig()
    if (!initAdminPassword) {
      if (isDevMode()) {
        initAdminPassword = 'dev'
      } else {
        throw new Error('Internal error: initial admin password not set up (did install.sh succeed?)')
      }
    }

    const added = await addEmailPasswordUser('admin', adminEmail, initAdminPassword, true)
    if (added) {
      console.log(`Added admin user ${adminEmail}`)
    }
  }

  const devModeEmail = 'dev@dev.localhost'
  if (isDevMode()) {
    const added = await addEmailPasswordUser('dev', devModeEmail, 'dev', false)
    if (added) {
      console.log(`Added dev user ${devModeEmail}`)
    }
  } else {
    // Clean up dev account in prod since its password is public
    const { count } = await getDb().user.deleteMany({ where: { email: devModeEmail } })
    if (count !== 0) {
      console.warn(`Warning: deleted dev user ${devModeEmail} (disallowed in production)`)
    }
  }
}

export type AuthInstance = Awaited<ReturnType<typeof createAuth>>
export type SessionAndUser = AuthInstance['$Infer']['Session']
export type Session = SessionAndUser['session']
export type User = SessionAndUser['user']

const g = globalThis as typeof globalThis & {
  __auth?: AuthInstance
}

/** (Re)initialize the authentication state. */
export async function initAuth(): Promise<void> {
  await ensureBuiltinUsersExist()
  g.__auth = await createAuth()
}

export async function getAuth(): Promise<AuthInstance> {
  if (!g.__auth) await initAuth()
  return g.__auth!
}

/** Require an authenticated user. Throws `unauthorized()` if not logged in. */
export async function requireAuth(): Promise<SessionAndUser> {
  await io()
  const auth = await getAuth()
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) unauthorized()
  return session
}
