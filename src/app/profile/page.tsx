import { redirect } from 'next/navigation'

import { requireAuth } from '@/lib/server/auth'

export default async function UserProfileForward() {
  const auth = await requireAuth()
  if (auth.user.name === 'profile') throw new Error('Unsupported username')
  redirect(`/${auth.user.name}`)
}
