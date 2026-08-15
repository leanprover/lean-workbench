import 'server-only'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { requireAdmin } from '@/app/admin/actions'
import { getConfig, isDevMode } from '@/lib/server/config'

import SetupFlow from './SetupFlow'

export default async function Setup() {
  await requireAdmin() // redirects to ./unauthorized.tsx for login

  if (getConfig().isSetupComplete) redirect('/admin')
  const baseUrl = isDevMode() ? `http://${(await headers()).get('host')}` : getConfig().baseUrl
  return <SetupFlow baseUrl={baseUrl} />
}
