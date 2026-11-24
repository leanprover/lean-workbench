import { getOAuthConfig, requireAdmin } from '@/lib/server/auth'
import { getConfig } from '@/lib/server/config'

import { AccessControl } from './AccessControl'
import { OAuthConfig } from './OAuthConfig'
import { UserManagement } from './UserManagement'

export const instant = false
export default async function AdminAccounts() {
  await requireAdmin()
  const config = getConfig()
  const oauthConfig = getOAuthConfig()

  return (
    <div className='admin-page'>
      <h1>Accounts</h1>
      <OAuthConfig oauthConfigPromise={oauthConfig} baseUrl={config.baseUrl} />
      <AccessControl />
      <UserManagement />
    </div>
  )
}
