import { requireUser } from '$lib/server/auth-helpers'
import { getConfig } from '$lib/server/config'
import { getDb } from '$lib/server/db'
import { error, json } from '@sveltejs/kit'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import type { RequestHandler } from './$types'

const PROJECT_NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,99}$/u

const TEMPLATE_FILES = ['lean-toolchain', 'lakefile.toml', 'Main.lean', 'lake-manifest.json']

interface TemplateMetadata {
  name: string
  description?: string
  packageSet?: string | null
}

function readTemplateMetadata(templatesDir: string, templateId: string): TemplateMetadata | null {
  const metaPath = path.join(templatesDir, templateId, 'metadata.json')
  if (!fs.existsSync(metaPath)) return null
  return JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as TemplateMetadata
}

/** Seed a workspace from a template. Returns the packageSet name, or null. */
function seedTemplate(dataDir: string, username: string, projectId: string, template: string): string | null {
  if (template === 'blank') return null

  const workspacesDir = path.join(dataDir, 'workspaces')
  const templatesDir = path.join(dataDir, 'templates')
  const workspace = path.join(workspacesDir, username, projectId)
  const sourceDir = path.join(templatesDir, template)
  const meta = readTemplateMetadata(templatesDir, template)
  if (!meta) {
    throw new Error(`Template "${template}" not found at ${sourceDir}`)
  }

  for (const file of TEMPLATE_FILES) {
    const src = path.join(sourceDir, file)
    const dst = path.join(workspace, file)
    if (!fs.existsSync(dst) && fs.existsSync(src)) {
      fs.copyFileSync(src, dst)
    }
  }

  const packageSet = meta.packageSet ?? null
  if (packageSet) {
    fs.mkdirSync(path.join(workspace, '.lake', 'packages'), { recursive: true })
  }

  return packageSet
}

export const GET: RequestHandler = async ({ locals }) => {
  const user = requireUser(locals)
  const db = getDb()
  const projects = await db.project.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
  })
  return json(projects)
}

export const POST: RequestHandler = async ({ locals, request }) => {
  const user = requireUser(locals)
  const { name, template = 'blank' } = (await request.json()) as {
    name?: string
    template?: string
  }

  if (!name || !PROJECT_NAME_RE.test(name)) {
    error(400, 'Invalid project name')
  }

  const config = getConfig()
  const templatesDir = path.join(config.dataDir, 'templates')
  const packageSetsDir = path.join(config.dataDir, 'package-sets')
  const workspacesDir = path.join(config.dataDir, 'workspaces')

  // Validate template
  if (template !== 'blank') {
    const meta = readTemplateMetadata(templatesDir, template)
    if (!meta) {
      error(400, `Template "${template}" not found`)
    }
    if (meta.packageSet) {
      const packagesFile = path.join(packageSetsDir, meta.packageSet, 'packages.txt')
      if (!fs.existsSync(packagesFile)) {
        error(500, `Package set "${meta.packageSet}" not found. Run scripts/seed-volume.sh first.`)
      }
    }
  }

  const db = getDb()

  // Check for duplicate
  const existing = await db.project.findUnique({
    where: { userId_name: { userId: user.id, name } },
  })
  if (existing) {
    error(409, 'Project already exists')
  }

  const projectId = crypto.randomUUID()
  const project = await db.project.create({
    data: { id: projectId, userId: user.id, name, template },
  })

  // Create workspace directory and seed template
  const workspace = path.join(workspacesDir, user.name, projectId)
  fs.mkdirSync(workspace, { recursive: true })
  const packageSet = seedTemplate(config.dataDir, user.name, projectId, template)
  if (packageSet) {
    await db.projectPackageSet.create({
      data: { projectId, packageSet },
    })
  }

  return json(project)
}
