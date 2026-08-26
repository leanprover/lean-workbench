/**
 * This @module contains various server functions
 * (https://react.dev/reference/rsc/server-functions).
 * *Utilities* for server functions that aren't themselves client-callable
 * should go into other modules. */

'use server'

import { devModeEmail, devModePassword } from '@leanprover/workbench-shared'
import { forbidden } from 'next/navigation'
import z from 'zod'

import { addEmailPasswordUser, getAuth, requireAuth } from '@/lib/server/auth'
import { getDb } from '@/lib/server/db'

import { isDevMode } from './config'
import { submitAction } from './util'

/** Set `isAdmin` on the requesting user. Dev mode only. */
export async function setIsAdmin(isAdmin: boolean) {
  if (!isDevMode()) {
    forbidden()
  }

  const session = await requireAuth()

  const db = getDb()
  await db.user.update({
    where: { id: session.user.id },
    data: { isAdmin },
  })
}

export const loginDevUser = submitAction(
  z.object({ n: z.int().gte(1) }),
  async ({ n }) => {
    if (!isDevMode()) forbidden()

    const email = devModeEmail(n)
    await addEmailPasswordUser('dev' + n, email, devModePassword, false)
    const auth = await getAuth()
    await auth.api.signInEmail({ body: { email, password: devModePassword } })
    return { ok: null }
  },
  { throwIfInvalid: true },
)
