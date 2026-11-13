import 'server-only'

import { io } from 'next/cache'
import { redirect } from 'next/navigation'

import { getConfig } from '@/lib/server/config'

import { SetupAdmin } from './SetupAdmin'

export default async function Unauthorized() {
  await io()
  const config = getConfig()

  if (config.isSetupComplete) redirect('/login?admin=true')

  // Note: if you change the admin password and get logged out before you
  // complete setup you will be forced to change the password *again*.
  //
  // In the other direction a determined admin could subvert the password
  // change expectation by logging via the appropriate /api/auth endpoint
  // before going to `/setup`, meaning they'd never see this page. We
  // recommend that system administrators do not do this.
  return <SetupAdmin />
}
