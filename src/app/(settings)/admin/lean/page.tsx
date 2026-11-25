import { CatchySuspense } from '@/app/components/CatchySuspense'
import { requireAdmin } from '@/lib/server/auth'
import { listInstalledToolchains } from '@/lib/server/elan'
import { listTemplates } from '@/lib/server/projectTemplate'

import { TemplateManagement } from './TemplateManagement'
import { ToolchainManagement } from './ToolchainManagement'

export const instant = false
export default async function AdminLean() {
  await requireAdmin()
  const templates = listTemplates()
  const installedToolchains = listInstalledToolchains().then(tc => tc.toReversed())

  return (
    <div className='admin-page'>
      <h1>Lean artifacts</h1>
      <ToolchainManagement installedToolchainsPromise={installedToolchains} />
      <section>
        <h2 className='with-filter'>Project Templates</h2>
        <CatchySuspense loading={<p>Loading toolchains and templates&hellip;</p>}>
          <TemplateManagement installedToolchainsPromise={installedToolchains} templatesPromise={templates} />
        </CatchySuspense>
      </section>
    </div>
  )
}
