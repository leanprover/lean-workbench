import { isDevMode } from '@leanprover/workbench-shared/node'
import { cacheLife } from 'next/cache'
import { use } from 'react'
import z from 'zod'

import { githubAPI } from '@/lib/server/github'
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

export async function CheckRelease() {
  'use cache' // Cache to avoid hitting the github api too much
  cacheLife({ revalidate: 30 * 60 })

  const latest = await githubAPI('/repos/leanprover/lean-workbench/releases/latest')
  if (!latest.ok) throw new Error(`Github API gave response ${latest.status}`)
  const { tag_name, html_url } = z.object({ tag_name: z.string(), html_url: z.url() }).parse(latest.response)

  const current = process.env.WORKBENCH_VERSION ?? 'unknown'
  if (tag_name === current) {
    return 'Workbench is up to date'
  }

  if (isDevMode() || !/^v\d+\.\d+\.\d+$/.test(current)) {
    return (
      <span>
        Latest release is {tag_name} (<a href={html_url}>Release notes</a>)
      </span>
    )
  }

  return (
    <span style={{ color: '#dc2626' }}>
      A new version of Lean Workbench, {tag_name}, is available (<a href={html_url}>Release notes</a>)
    </span>
  )
}
