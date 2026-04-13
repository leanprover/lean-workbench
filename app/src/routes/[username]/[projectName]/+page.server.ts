import { requireUser } from '$lib/server/auth-helpers'
import { getDb } from '$lib/server/db'
import { error } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'

const USERNAME_RE = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/

export const load: PageServerLoad = async ({ locals, params }) => {
  const viewer = requireUser(locals)
  const { username: ownerUsername, projectName } = params

  if (!USERNAME_RE.test(ownerUsername)) {
    error(404, 'Not found')
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

  return {
    ownerUsername,
    viewerUsername: viewer.name,
    projectName: project.name,
    isOwner,
  }
}
