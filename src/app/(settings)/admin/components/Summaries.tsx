import { use } from 'react'

import { type TemplateInfo } from '@/lib/server/projectTemplate'

interface ToolchainSummaryProps {
  installedToolchainsPromise: Promise<string[]>
}

export function ToolchainSummary({ installedToolchainsPromise }: ToolchainSummaryProps) {
  const installedToolchains = use(installedToolchainsPromise)
  if (installedToolchains.length === 0) {
    return <span style={{ color: '#dc2626' }}>No toolchains installed</span>
  }

  return (
    <>
      {installedToolchains.length} toolchain{installedToolchains.length > 1 && 's'} installed
    </>
  )
}

interface TemplateSummaryProps {
  templatesPromise: Promise<TemplateInfo[]>
}

export function TemplateSummary({ templatesPromise }: TemplateSummaryProps) {
  const templates = use(templatesPromise)
  const visible = templates.filter(template => template.visible)

  if (visible.length === 0) {
    return <span style={{ color: '#dc2626' }}>No user-visible templates. Project creation disabled.</span>
  }

  return (
    <>
      {visible.length} template{visible.length > 1 && 's'}
      {templates.length === visible.length ? ' installed' : ` visible (${templates.length} total installed)`}
    </>
  )
}
