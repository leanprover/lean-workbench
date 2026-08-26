import { listTemplates } from '@/app/[userName]/actions'

import { requireAdmin } from './actions'
import { AccessControl } from './components/AccessControl'
import { HealthMonitor } from './components/HealthMonitor'
import { OAuthConfig } from './components/OAuthConfig'
import { SessionViewer } from './components/SessionViewer'
import { TemplateManagement } from './components/TemplateManagement'
import { UserManagement } from './components/UserManagement'

export const instant = false
export default async function AdminPage() {
  await requireAdmin()
  const templates = await listTemplates()

  return (
    <div className='admin-page'>
      <h1>Admin</h1>
      <UserManagement />
      <OAuthConfig />
      <SessionViewer />
      <AccessControl />
      <HealthMonitor />
      <TemplateManagement templates={templates} />
    </div>
  )
}
