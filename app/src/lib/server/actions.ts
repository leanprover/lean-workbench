/** @module https://react.dev/reference/rsc/server-functions */

'use server'

import { getAuth } from '@/lib/server/auth'
import { getDb } from '@/lib/server/db'
import { headers } from 'next/headers'
import { forbidden, unauthorized } from 'next/navigation'
import { isDevMode } from './config'

/** Set `isAdmin` on the requesting user. Dev mode only. */
export async function setIsAdmin(isAdmin: boolean) {
  if (!isDevMode()) {
    forbidden()
  }

  const auth = getAuth()
  const session = await auth.api.getSession({
    headers: await headers(),
  })
  if (!session) {
    unauthorized()
  }

  const db = getDb()
  await db.user.update({
    where: { id: session.user.id },
    data: { isAdmin },
  })
}
