'use server'

import { headers } from 'next/headers'
import z from 'zod'

import { getAuth, requireAuth } from '@/lib/server/auth'
import { getDb } from '@/lib/server/db'
import { githubAPI } from '@/lib/server/github'
import { submitAction } from '@/lib/server/util'
import { type ActionResponse } from '@/lib/util'

export async function clearUserAvatar() {
  const session = await requireAuth()
  await getDb().user.update({
    where: { id: session.user.id },
    data: { image: null },
  })
  return { ok: null }
}

export async function setUserAvatarGitHub(): Promise<ActionResponse<null>> {
  const session = await requireAuth()
  const db = getDb()

  const githubAccount = await db.account.findFirst({
    where: { userId: session.user.id, providerId: 'github' },
    select: { accountId: true },
  })
  if (!githubAccount) return { error: 'Could not find linked GitHub account' }

  // https://docs.github.com/en/rest/users/users?apiVersion=2026-03-10#get-a-user-using-their-id
  const result = await githubAPI(`/user/${encodeURIComponent(githubAccount.accountId)}`)
  if (!result.ok) return { error: `Could not find GitHub profile: ${result.status}` }
  const parsedResult = z.object({ avatar_url: z.url() }).safeParse(result.response)
  if (!parsedResult.success) {
    console.error('Unexpected response from GitHub', parsedResult.error)
    return { error: 'Unexpected response from GitHub' }
  }

  await db.user.update({
    where: { id: session.user.id },
    data: { image: parsedResult.data.avatar_url },
  })
  return { ok: null }
}

export const setDisplayName = submitAction(
  z.object({ displayName: z.string().trim().max(256).optional() }),
  async ({ displayName }): Promise<ActionResponse<null>> => {
    await requireAuth()
    const auth = await getAuth()
    await auth.api.updateUser({ headers: await headers(), body: { displayName: displayName || null } })
    return { ok: null }
  },
)
