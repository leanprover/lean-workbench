import { headers } from 'next/headers'

import { requireAdmin } from '@/lib/server/auth'
import { getConfig, isDevMode } from '@/lib/server/config'

import SetupFlow from './SetupFlow'

export default async function Setup() {
  await requireAdmin() // redirects to ./unauthorized.tsx for login

  const baseUrl = isDevMode() ? `http://${(await headers()).get('host')}` : getConfig().baseUrl
  return <SetupFlow baseUrl={baseUrl} />
}
