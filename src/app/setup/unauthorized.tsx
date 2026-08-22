import 'server-only'

import { io } from 'next/cache'

import AdminLogin from '@/app/admin/components/AdminLogin'
import { getConfig, isDevMode } from '@/lib/server/config'

import CreateAdmin from './CreateAdmin'

export default async function Unauthorized() {
  await io()
  const config = getConfig()
  if (!config.isSetupComplete && (isDevMode() || config.initAdminPassword)) {
    return <CreateAdmin />
  } else {
    return <AdminLogin />
  }
}
