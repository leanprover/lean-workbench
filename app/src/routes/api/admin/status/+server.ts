import { requireAdmin } from '$lib/server/auth-helpers'
import { getEditorSessionManager } from '$lib/server/editorSessions'
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async ({ locals }) => {
  await requireAdmin(locals)
  const mgr = getEditorSessionManager()
  const result: Record<string, { port: number; pid: number; workspaceDir: string; projectId: string; alive: boolean }> =
    {}
  for (const { key, info, alive } of mgr.listSessions()) {
    result[key] = { ...info, alive }
  }
  return json({ editorSessions: result })
}
