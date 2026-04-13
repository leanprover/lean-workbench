import { getAuth } from '$lib/server/auth'
import { getConfig } from '$lib/server/config'
import { getDb } from '$lib/server/db'
import { fail } from '@sveltejs/kit'

const devLogin = (email: string, name: string, isAdmin: boolean) => async () => {
    const config = getConfig()
    if (!config.isDevMode) {
      fail(403, '/')
    }

    const auth = getAuth()
    const db = getDb()

    const exists = await db.user.findFirst({ where: { email } })
    if (!exists) {
      const { user } = await auth.api.signUpEmail({ body: { email, name, password: 'dev' } })
      if (isAdmin) {
          await db.user.update({ where: { id: user.id }, data: { isAdmin: true } })
      }
    }

    // This sets the session cookie via better-auth's `sveltekitCookies` plugin
    await auth.api.signInEmail({
      body: { email, password: 'dev' },
    })
}

export const actions = {
    devLogin: devLogin('dev@dev.localhost', 'dev', false),
    devAdminLogin: devLogin('dev-admin@dev.localhost', 'dev-admin', true)
}