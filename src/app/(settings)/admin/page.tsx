import { isDevMode } from '@leanprover/workbench-shared/node'
import Link from 'next/link'

import { CatchySuspense } from '@/app/components/CatchySuspense'
import { fetchHealth } from '@/lib/server/adminActions'
import { requireAdmin } from '@/lib/server/auth'
import { getConfig } from '@/lib/server/config'
import { listInstalledToolchains } from '@/lib/server/elan'
import { listTemplates } from '@/lib/server/projectTemplate'

import { HealthMonitor } from './components/HealthMonitor'
import { CheckRelease, TemplateSummary, ToolchainSummary } from './components/Summaries'

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
          <li>
            Lean Workbench {process.env.WORKBENCH_VERSION}
            {!isDevMode() && process.env.WORKBENCH_COMMIT && (
              <>
                {' '}
                — commit{' '}
                <a href={`https://github.com/leanprover/lean-workbench/tree/${process.env.WORKBENCH_COMMIT}`}>
                  <code>{process.env.WORKBENCH_COMMIT.slice(0, 10)}</code>
                </a>
              </>
            )}
          </li>
          <li>
            <CatchySuspense loading='Checking latest release…' error='Error checking for latest release'>
              <CheckRelease />
            </CatchySuspense>
          </li>
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
          <li>
            Publications can be created from projects and viewed without logging in:{' '}
            {config.isPublishingEnabled ? 'enabled' : 'disabled'}
          </li>
          <li>
            Projects can be set public, allowing read-write collaboration:{' '}
            {config.isPublicProjectSharingEnabled ? 'enabled' : 'disabled'}
          </li>
        </ul>
      </section>
      <HealthMonitor systemHealth={systemHealth} />
    </div>
  )
}
