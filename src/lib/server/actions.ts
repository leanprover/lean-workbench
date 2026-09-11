/**
 * This @module contains various server functions
 * (https://react.dev/reference/rsc/server-functions).
 * *Utilities* for server functions that aren't themselves client-callable
 * should go into other modules. */

'use server'

import { devModeEmail, devModePassword } from '@leanprover/workbench-shared'
import { forbidden } from 'next/navigation'
import z from 'zod'

import { addEmailPasswordUser, getAuth, requireAdmin, requireAuth } from '@/lib/server/auth'
import { getDb } from '@/lib/server/db'
import { type TrackedCommandScope, zTrackedCommandScope } from '@/lib/util'

import { isDevMode } from './config'
import { getTrackedCommandState, getUserTrackedCommandState } from './trackedCommand'
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

/** The tracked command that the requester may watch at {@link trackedCommandStreamUrl},
 * under the same authorization as the route that would stream it. */
async function probeTrackedCommand(rawScope: TrackedCommandScope, key: string) {
  const scope = zTrackedCommandScope.parse(rawScope)
  if (scope === 'admin') {
    await requireAdmin()
    return getTrackedCommandState(key)
  }
  const { user } = await requireAuth()
  return getUserTrackedCommandState(user, key)
}

/** Whether a tracked command the requester may watch is currently running. */
export async function isTrackedCommandRunning(scope: TrackedCommandScope, key: string) {
  return (await probeTrackedCommand(scope, key))?.status === 'running'
}

/** Whether the requester has any tracked command output to watch under this key,
 * running or finished. */
export async function isTrackedCommandAvailable(scope: TrackedCommandScope, key: string) {
  return !!(await probeTrackedCommand(scope, key))
}
