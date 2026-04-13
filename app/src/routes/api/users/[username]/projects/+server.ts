import { requireUser } from '$lib/server/auth-helpers'
import { getDb } from '$lib/server/db'
import { error, json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'

const USERNAME_RE = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/

export const GET: RequestHandler = async ({ locals, params }) => {
  const viewer = requireUser(locals)
  const { username } = params

  if (!USERNAME_RE.test(username)) {
    error(404, 'Not found')
  }

  const db = getDb()

  if (viewer.name === username) {
    // Own projects
    const projects = await db.project.findMany({
      where: { userId: viewer.id },
      orderBy: { createdAt: 'desc' },
    })
    return json(projects)
  }

  // Other user's public projects
  const projects = await db.project.findMany({
    where: {
      user: { name: username },
      isPublic: true,
    },
    orderBy: { createdAt: 'desc' },
  })
  return json(projects)
}
