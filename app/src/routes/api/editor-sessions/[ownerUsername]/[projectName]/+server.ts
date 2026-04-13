import { requireUser } from '$lib/server/auth-helpers'
import { getDb } from '$lib/server/db'
import { getEditorSessionManager } from '$lib/server/editorSessions'
import { error, json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'

const USERNAME_RE = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/

export const PUT: RequestHandler = async ({ locals, params }) => {
  const viewer = requireUser(locals)
  const { ownerUsername, projectName } = params

  if (!USERNAME_RE.test(ownerUsername)) {
    error(400, 'Malformed username')
  }

  const db = getDb()
  const owner = await db.user.findFirst({ where: { name: ownerUsername } })
  if (!owner) {
    error(404, 'User not found')
  }

  const project = await db.project.findFirst({
    where: { userId: owner.id, name: projectName },
  })
  if (!project) {
    error(404, 'Project not found')
  }

  const isOwner = viewer.name === ownerUsername
  if (!isOwner && !project.isPublic) {
    error(404, 'Project not found')
  }

  const editorSessions = getEditorSessionManager()
  try {
    await editorSessions.startSession(viewer.name, ownerUsername, projectName, project.id)
  } catch (err) {
    console.error('Failed to start editor session:', (err as Error).message)
    error(500, 'Failed to start editor session')
  }

  const encodedName = encodeURIComponent(projectName)
  return json({ iframeSrc: `/_vs/${viewer.name}/${ownerUsername}/${encodedName}/` })
}
