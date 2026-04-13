import { requireAdmin } from '$lib/server/auth-helpers'
import { getEditorSessionManager } from '$lib/server/editorSessions'
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'

export const DELETE: RequestHandler = async ({ locals, params }) => {
  await requireAdmin(locals)
  getEditorSessionManager().killSession(params.viewer, params.projectId)
  return json({ ok: true })
}
