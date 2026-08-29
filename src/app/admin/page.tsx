import { requireAdmin } from '@/lib/server/auth'
import { listInstalledToolchains, listTemplates } from '@/lib/server/util'

import { fetchHealth } from './actions'
import { AccessControl } from './components/AccessControl'
import { HealthMonitor } from './components/HealthMonitor'
import { OAuthConfig } from './components/OAuthConfig'
import { SessionViewer } from './components/SessionViewer'
import { TemplateManagement } from './components/TemplateManagement'
import { ToolchainManagement } from './components/ToolchainManagement'
import { UserManagement } from './components/UserManagement'

export const instant = false
export default async function AdminPage() {
  await requireAdmin()
  const systemHealth = fetchHealth()
  const templates = listTemplates()
  const toolchains = listInstalledToolchains()

  return (
    <div className='admin-page'>
      <h1>Admin</h1>
      <UserManagement />
      <OAuthConfig />
      <SessionViewer />
      <AccessControl />
      <HealthMonitor systemHealth={systemHealth} />
      <ToolchainManagement toolchains={toolchains} />
      <TemplateManagement toolchains={toolchains} templates={templates} />
    </div>
  )
}
