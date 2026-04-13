import { requireAdmin } from '$lib/server/auth-helpers'
import { getConfig } from '$lib/server/config'
import { error, json } from '@sveltejs/kit'
import { execSync } from 'node:child_process'
import path from 'node:path'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async ({ locals }) => {
  await requireAdmin(locals)
  const workspacesDir = path.join(getConfig().dataDir, 'workspaces')
  try {
    const out = execSync(`du -sh ${workspacesDir}`, { encoding: 'utf8', timeout: 30_000 })
    const size = out.split('\t')[0] ?? '?'
    return json({ workspaces: size })
  } catch (e: unknown) {
    error(500, (e as Error).message)
  }
}
