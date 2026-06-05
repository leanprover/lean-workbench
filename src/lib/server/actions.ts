/**
 * This @module contains various server functions
 * (https://react.dev/reference/rsc/server-functions).
 * *Utilities* for server functions that aren't themselves client-callable
 * should go into other modules. */

'use server'

import { requireAuth } from '@/lib/server/auth'
import { getDb } from '@/lib/server/db'
import { forbidden } from 'next/navigation'
import { isDevMode } from './config'

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
