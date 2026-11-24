import { isDevMode } from '@leanprover/workbench-shared/node'
import Link from 'next/link'

import { CatchySuspense } from '@/app/components/CatchySuspense'
import { fetchHealth } from '@/lib/server/adminActions'
import { requireAdmin } from '@/lib/server/auth'
import { getConfig } from '@/lib/server/config'
import { listInstalledToolchains } from '@/lib/server/elan'
import { listTemplates } from '@/lib/server/projectTemplate'

import { HealthMonitor } from './components/HealthMonitor'
import { TemplateSummary, ToolchainSummary } from './components/Summaries'

export const instant = false
export default async function AdminPage() {
  await requireAdmin()
  const config = getConfig()
  const systemHealth = fetchHealth()
  const templates = listTemplates()
  const installedToolchains = listInstalledToolchains()

  return (
    <div className='admin-page'>
      <h1>System</h1>
      <section>
        <hr />
        <ul className='list'>
          {isDevMode() && (
            <li>
              <span style={{ color: '#dc2626' }}>DEVELOPMENT MODE — INSECURE</span>
            </li>
          )}
          <li>
            GitHub OAuth:{' '}
            {config.githubAuth ? <>Configured</> : <span style={{ color: '#dc2626' }}>Not Configured</span>} (modify in{' '}
            <Link href='/admin/accounts'>Accounts</Link>)
          </li>
          {config.githubAuth && (
            <li>
              Signup: {config.registrationMode === 'open' ? <>Open to anyone</> : <>Pre-approved accounts only</>}{' '}
              (configure in <Link href='/admin/accounts'>Accounts</Link>)
            </li>
          )}
          <li>
            <CatchySuspense loading={<>Loading toolchains&hellip;</>}>
              <ToolchainSummary installedToolchainsPromise={installedToolchains} />
            </CatchySuspense>{' '}
            (configure in <Link href='/admin/lean'>Lean artifacts</Link>)
          </li>
          <li>
            <CatchySuspense loading={<>Loading templates&hellip;</>}>
              <TemplateSummary templatesPromise={templates} />
            </CatchySuspense>{' '}
            (configure in <Link href='/admin/lean'>Lean artifacts</Link>)
          </li>
        </ul>
      </section>
      <HealthMonitor systemHealth={systemHealth} />
    </div>
  )
}
