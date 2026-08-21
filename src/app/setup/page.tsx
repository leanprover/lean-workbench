import 'server-only'

import { LEAN_VERSION_RE } from '@leanprover/workbench-shared'
import { headers } from 'next/headers'
import { z } from 'zod'

import { requireAdmin } from '@/app/admin/actions'
import { getConfig, isDevMode } from '@/lib/server/config'

import { fetchSetupStatus } from './actions'
import SetupFlow from './SetupFlow'

/** Fetch mathlib4 v4.* tags, newest-first, paginating until exhausted. */
async function fetchLeanVersions(): Promise<string[]> {
  const versions: string[] = []
  // This relies on version tags being returned first.
  const res: Response = await fetch('https://api.github.com/repos/leanprover-community/mathlib4/tags?per_page=100')
  if (!res.ok) throw new Error(`GitHub API ${res.status}`)
  const data = z.array(z.object({ name: z.string() })).parse(await res.json())
  for (const item of data) if (LEAN_VERSION_RE.test(item.name)) versions.push(item.name)
  return versions
}

export const instant = false

export default async function Setup() {
  await requireAdmin() // redirects to ./unauthorized.tsx for login
  const baseUrl = isDevMode() ? `http://${(await headers()).get('host')}` : getConfig().baseUrl
  const [leanVersions, initialSetupStatus] = await Promise.all([
    fetchLeanVersions().catch(() => []), // On error, only 'latest' is available
    fetchSetupStatus(),
  ])

  return <SetupFlow baseUrl={baseUrl} leanVersions={leanVersions} initialSetupStatus={initialSetupStatus} />
}
