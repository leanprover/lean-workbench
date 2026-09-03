import CatchySuspense from '@/app/components/CatchySuspense'
import { requireAdmin } from '@/lib/server/auth'
import { getOAuthConfig, requireAdmin } from '@/lib/server/auth'
import { getConfig } from '@/lib/server/config'
import { listInstalledToolchains } from '@/lib/server/elan'
import { listTemplates } from '@/lib/server/projectTemplate'

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
  const config = getConfig()
  const templates = listTemplates()
  const oauthConfig = getOAuthConfig()
  const installedToolchains = listInstalledToolchains().then(tc => tc.toReversed())
  const systemHealth = fetchHealth()

  return (
    <div className='admin-page'>
      <h1>Admin</h1>
      <UserManagement />
      <OAuthConfig oauthConfigPromise={oauthConfig} baseUrl={config.baseUrl} />
      <SessionViewer />
      <AccessControl />
      <HealthMonitor systemHealth={systemHealth} />
      <ToolchainManagement installedToolchainsPromise={installedToolchains} />
      <section>
        <h2>Project Templates</h2>
        <CatchySuspense loading={<p>Loading toolchains and templates&hellip;</p>}>
          <TemplateManagement installedToolchainsPromise={installedToolchains} templatesPromise={templates} />
        </CatchySuspense>
      </section>
    </div>
  )
}
