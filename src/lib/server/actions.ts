/**
 * This @module contains various server functions
 * (https://react.dev/reference/rsc/server-functions).
 * *Utilities* for server functions that aren't themselves client-callable
 * should go into other modules. */

'use server'

import { forbidden } from 'next/navigation'
import z from 'zod'

import { ensureDevUserAccount, requireAuth } from '@/lib/server/auth'
import { getDb } from '@/lib/server/db'

import { isDevMode } from './config'

const zDevUserNumber = z.number().int().min(0).max(999)

/** Ensure the numbered dev account (`dev0`, `dev1`, ..) exists,
 * returning credentials to sign in to it. Dev mode only. */
export async function ensureDevUser(n: number): Promise<{ email: string; password: string }> {
  if (!isDevMode()) {
    forbidden()
  }

  return ensureDevUserAccount(`dev${zDevUserNumber.parse(n)}`)
}

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
