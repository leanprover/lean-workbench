import { requireAdmin } from '@/lib/server/auth'
import { listTemplates } from '@/lib/server/projectTemplate'

import { fetchHealth } from './actions'
import { AccessControl } from './components/AccessControl'
import { HealthMonitor } from './components/HealthMonitor'
import { OAuthConfig } from './components/OAuthConfig'
import { SessionViewer } from './components/SessionViewer'
import { TemplateManagement } from './components/TemplateManagement'
import { UserManagement } from './components/UserManagement'

export const instant = false
export default async function AdminPage() {
  await requireAdmin()
  const templates = listTemplates()
  const systemHealth = fetchHealth()

  return (
    <div className='admin-page'>
      <h1>Admin</h1>
      <UserManagement />
      <OAuthConfig />
      <SessionViewer />
      <AccessControl />
      <HealthMonitor systemHealth={systemHealth} />
      <TemplateManagement templates={templates} />
    </div>
  )
}
