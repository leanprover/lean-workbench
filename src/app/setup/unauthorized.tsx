import 'server-only'

import AdminLogin from '@/app/admin/components/AdminLogin'
import { getConfig, isDevMode } from '@/lib/server/config'

import CreateAdmin from './CreateAdmin'

export default function Unauthorized() {
  const config = getConfig()
  if (isDevMode() || config.initAdminPassword) {
    return <CreateAdmin />
  } else {
    return <AdminLogin />
  }
}
