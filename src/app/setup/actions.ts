'use server'

import { adminEmail, devModePassword } from '@leanprover/workbench-shared'
import { hashPassword } from 'better-auth/crypto'
import { randomUUID } from 'crypto'
import { headers } from 'next/headers'
import { z } from 'zod'

import { requireAdmin } from '@/app/admin/actions'
import { getAuth, initAuth } from '@/lib/server/auth'
import { getConfig, hasGithubAuth, isDevMode, saveConfig, zGithubAuthConfig } from '@/lib/server/config'
import { getDb } from '@/lib/server/db'
import { getSeedState, startSeed as doStartSeed } from '@/lib/server/seed'
import type { ActionResponse } from '@/lib/util'

const zInitialLogin = z.object({
  initAdminPassword: z.string(),
  newAdminPassword: z.string(),
})

/**
 * If `initAdminPassword` is set in the config JSON, then this server function will allow a
 * request containing that `initAdminPassword` to set or reset the admin password.
 */
export async function initialLogin(formData: FormData): Promise<ActionResponse<null>> {
  const cfg = getConfig()

  const parsed = zInitialLogin.safeParse({
    initAdminPassword: formData.get('initAdminPassword'),
    newAdminPassword: formData.get('newAdminPassword'),
  })
  if (!parsed.success) return { error: parsed.error.issues[0]!.message }
  if (parsed.data.newAdminPassword.length < 8) return { error: 'Password is too short' }

  let initialAdminPassword: string
  if (isDevMode()) {
    initialAdminPassword = devModePassword
  } else if (cfg.initAdminPassword) {
    initialAdminPassword = cfg.initAdminPassword
  } else {
    // there's no initial admin password in the setup
    // this may be because we already created the admin user
    const adminUser = await getDb().user.findUnique({ where: { email: adminEmail } })
    if (adminUser) return { error: 'The admin user is already set up' }

    // or because something was misconfigured
    throw new Error('Initial admin password misconfigured')
  }

  if (parsed.data.initAdminPassword !== initialAdminPassword) {
    // Ham-fisted timing attack resistance
    await new Promise(r => setTimeout(r, 1000 + Math.random() * 1000))
    return { error: 'Incorrect initial admin password' }
  }

  // Unconditionally overwrite the admin user's account information password
  const db = getDb()
  const hashedPassword = await hashPassword(parsed.data.newAdminPassword)
  await db.$transaction(async tx => {
    const existingAdminUser = await tx.user.findUnique({ where: { email: adminEmail } })

    let userId
    if (existingAdminUser) {
      console.log(`Overwriting password for existing admin user`)
      userId = existingAdminUser.id
      await tx.account.deleteMany({ where: { userId: existingAdminUser.id } })
    } else {
      console.log(`Creating admin user with provided password`)
      userId = randomUUID()
      await tx.user.create({ data: { id: userId, name: 'admin', email: adminEmail, isAdmin: true } })
    }

    await tx.account.create({
      data: {
        id: randomUUID(),
        userId,
        accountId: userId /* better-auth convention */,
        providerId: 'credential',
        password: hashedPassword,
      },
    })
  })

  // Delete the initial admin password to prevent further resets
  delete cfg.initAdminPassword
  await saveConfig()

  // We just created the user, so this should work
  const auth = await getAuth()
  await auth.api.signInEmail({
    body: { email: adminEmail, password: parsed.data.newAdminPassword },
    headers: await headers(),
  })

  return { ok: null }
}

export async function saveSetupConfig(formData: FormData): Promise<ActionResponse<boolean>> {
  await requireAdmin()

  const cfg = getConfig()
  if (cfg.isSetupComplete) return { error: 'Setup already completed' }

  const parsed = zGithubAuthConfig.safeParse({
    clientId: formData.get('clientId'),
    clientSecret: formData.get('clientSecret'),
  })
  if (!parsed.success) return { error: parsed.error.issues[0]!.message }

  const githubAuth = parsed.data
  cfg.githubAuth = githubAuth
  await saveConfig()

  // Reinitialize auth with new configuration
  await initAuth()

  return { ok: true }
}

export async function startSeed(leanVersion: string | undefined): Promise<ActionResponse<boolean>> {
  await requireAdmin()

  return doStartSeed(leanVersion)
}

export async function fetchSetupStatus() {
  await requireAdmin()

  const cfg = getConfig()
  const st = getSeedState()
  return {
    configSaved: hasGithubAuth(cfg),
    seeding: st.inProgress,
    seeded: cfg.isSetupComplete,
  }
}
