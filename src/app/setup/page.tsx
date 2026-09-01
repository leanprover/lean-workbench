import { headers } from 'next/headers'

import { requireAdmin } from '@/lib/server/auth'
import { getConfig, isDevMode } from '@/lib/server/config'
import { fetchSetupStatus } from '@/lib/server/seed'

import SetupFlow from './SetupFlow'

export const instant = false

export default async function Setup() {
  await requireAdmin() // redirects to ./unauthorized.tsx for login
  const baseUrl = isDevMode() ? `http://${(await headers()).get('host')}` : getConfig().baseUrl
  const statusOnMount = await fetchSetupStatus()
  return <SetupFlow baseUrl={baseUrl} statusOnMount={statusOnMount} />
}
