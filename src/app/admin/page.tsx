import { requireAdmin } from './actions'
import { AccessControl } from './components/AccessControl'
import { HealthMonitor } from './components/HealthMonitor'
import { OAuthConfig } from './components/OAuthConfig'
import { SessionViewer } from './components/SessionViewer'
import { UserManagement } from './components/UserManagement'

export default async function AdminPage() {
  await requireAdmin()
  return (
    <div className='admin-page'>
      <h1>Admin</h1>
      <UserManagement />
      <OAuthConfig />
      <SessionViewer />
      <AccessControl />
      <HealthMonitor />
    </div>
  )
}
