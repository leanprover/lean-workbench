import { Suspense } from 'react'
import { requireAdmin } from './actions'
import { AccessControl } from './components/AccessControl'
import { HealthMonitor } from './components/HealthMonitor'
import { OAuthConfig } from './components/OAuthConfig'
import { SessionViewer } from './components/SessionViewer'
import { UserManagement } from './components/UserManagement'

export default function AdminPage() {
  return (
    <div className='admin-page'>
      <h1>Admin</h1>
      <Suspense fallback={<p>Loading...</p>}>
        <AdminBody />
      </Suspense>
    </div>
  )
}

async function AdminBody() {
  await requireAdmin()
  return (
    <>
      <UserManagement />
      <OAuthConfig />
      <SessionViewer />
      <AccessControl />
      <HealthMonitor />
    </>
  )
}
