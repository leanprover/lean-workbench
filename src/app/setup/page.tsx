import 'server-only'

import { headers } from 'next/headers'
import { forbidden, redirect } from 'next/navigation'

import { requireAuth } from '@/lib/server/auth'
import { getConfig, isDevMode } from '@/lib/server/config'

import SetupFlow from './SetupFlow'

export default async function Setup() {
  const user = await requireAuth() // redirects to ./unauthorized.tsx for login
  if (!user.user.isAdmin) forbidden()
  if (getConfig().isSetupComplete) redirect('/admin')
  const baseUrl = isDevMode() ? `http://${(await headers()).get('host')}` : getConfig().baseUrl
  return <SetupFlow baseUrl={baseUrl} />
}
