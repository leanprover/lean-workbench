import { requireAdmin } from '$lib/server/auth-helpers'
import { getConfig } from '$lib/server/config'
import { getDb } from '$lib/server/db'
import { getEditorSessionManager } from '$lib/server/editorSessions'
import { error, json } from '@sveltejs/kit'
import fs from 'node:fs'
import path from 'node:path'
import type { RequestHandler } from './$types'

export const DELETE: RequestHandler = async ({ locals, params }) => {
  const admin = await requireAdmin(locals)
  const { userId } = params

  if (userId === admin.id) {
    error(400, 'Cannot delete yourself')
  }

  const db = getDb()
  const target = await db.user.findUnique({ where: { id: userId } })
  if (!target) {
    error(404, 'User not found')
  }

  // Kill all active editor sessions for this user
  const mgr = getEditorSessionManager()
  for (const { key, info } of mgr.listSessions()) {
    const [sessionUser] = key.split('/')
    if (sessionUser === target.name) {
      mgr.killSession(target.name, info.projectId)
    }
  }

  // Remove workspace directory
  const workspacesDir = path.join(getConfig().dataDir, 'workspaces', target.name)
  fs.rmSync(workspacesDir, { recursive: true, force: true })

  // Delete from database (cascades to projects, sessions, accounts)
  await db.user.delete({ where: { id: userId } })

  return json({ ok: true })
}
