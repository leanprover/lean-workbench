import { redirect } from 'next/navigation'

import { requireAuth } from '@/lib/server/auth'

export default async function UserProfileForward() {
  const auth = await requireAuth()
  redirect(`/${auth.user.name}`)
}
