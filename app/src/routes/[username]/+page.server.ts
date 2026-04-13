import { requireUser } from '$lib/server/auth-helpers'
import { getConfig } from '$lib/server/config'
import { getDb } from '$lib/server/db'
import { error } from '@sveltejs/kit'
import fs from 'fs'
import path from 'path'
import type { PageServerLoad } from './$types'

function listTemplates(dataDir: string): { id: string; name: string; description: string }[] {
  const templatesDir = path.join(dataDir, 'templates')
  const result: { id: string; name: string; description: string }[] = [
    { id: 'blank', name: 'Blank', description: 'Empty workspace' },
  ]
  if (!fs.existsSync(templatesDir)) return result
  for (const entry of fs.readdirSync(templatesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const metaPath = path.join(templatesDir, entry.name, 'metadata.json')
    if (!fs.existsSync(metaPath)) continue
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as {
      name: string
      description?: string
    }
    result.push({ id: entry.name, name: meta.name, description: meta.description ?? '' })
  }
  return result
}

export const load: PageServerLoad = async ({ locals, params }) => {
  const viewer = requireUser(locals)
  const { username } = params

  const db = getDb()
  const pageUser = await db.user.findFirst({ where: { name: username } })
  if (!pageUser) {
    error(404, 'User not found')
  }

  const isOwner = viewer.name === username

  const projects = isOwner
    ? await db.project.findMany({
        where: { userId: viewer.id },
        orderBy: { createdAt: 'desc' },
      })
    : await db.project.findMany({
        where: { user: { name: username }, isPublic: true },
        orderBy: { createdAt: 'desc' },
      })

  const config = getConfig()
  const templates = isOwner ? listTemplates(config.dataDir) : []

  return { username, isOwner, projects, templates }
}
