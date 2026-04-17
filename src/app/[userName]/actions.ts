'use server'

import { requireAuth } from '@/lib/server/actions'
import { getPackageSetsDir, getTemplatesDir, getWorkspacesDir } from '@/lib/server/config'
import { getDb } from '@/lib/server/db'
import { type ActionResponse } from '@/lib/util'
import { Project } from '@/prisma/generated/client'
import { forbidden } from 'next/navigation'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import z from 'zod'

const PROJECT_NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,99}$/u
const TEMPLATE_ID_RE = /^[\.a-zA-Z0-9_-]+$/

const zProjectName = z.string().regex(PROJECT_NAME_RE, 'Invalid project name')
const zTemplateId = z.string().regex(TEMPLATE_ID_RE, 'Invalid template ID')

const zTemplateMetadata = z.object({
  name: z.string(),
  description: z.string().optional(),
  packageSet: z.string().optional(),
})

type TemplateMetadata = z.infer<typeof zTemplateMetadata>

function readTemplateMetadata(templateDir: string): TemplateMetadata | null {
  const metaPath = path.join(templateDir, 'metadata.json')
  if (!fs.existsSync(metaPath)) return null
  const raw = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
  return zTemplateMetadata.parse(raw)
}

const TEMPLATE_FILES = ['lean-toolchain', 'lakefile.toml', 'Main.lean', 'lake-manifest.json']

export interface ProjectInfo {
  id: string
  name: string
  isPublic: boolean
}

export interface TemplateInfo {
  id: string
  name: string
  description: string
}

// --- Queries ---

export async function listTemplates(): Promise<ActionResponse<TemplateInfo[]>> {
  await requireAuth()

  const templatesDir = getTemplatesDir()

  const result: TemplateInfo[] = [{ id: 'blank', name: 'Blank', description: 'Empty workspace' }]
  if (!fs.existsSync(templatesDir)) return { ok: result }

  for (const entry of fs.readdirSync(templatesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const meta = readTemplateMetadata(path.join(entry.parentPath, entry.name))
    if (!meta) continue
    result.push({
      id: entry.name,
      name: meta.name,
      description: meta.description ?? '',
    })
  }

  return { ok: result }
}

// --- Mutations ---

const zCreateProject = z.object({
  name: zProjectName,
  template: zTemplateId.default('blank'),
})

export async function createProject(name: string, template: string): Promise<ActionResponse<ProjectInfo>> {
  const parsed = zCreateProject.safeParse({ name, template })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const session = await requireAuth()

  const db = getDb()
  const user = session.user

  // Validate template exists
  if (parsed.data.template !== 'blank') {
    const templateDir = path.join(getTemplatesDir(), parsed.data.template)
    const meta = readTemplateMetadata(templateDir)
    if (!meta) return { error: `Template "${parsed.data.template}" not found` }
    if (meta.packageSet) {
      const packagesFile = path.join(getPackageSetsDir(), meta.packageSet, 'packages.txt')
      if (!fs.existsSync(packagesFile)) {
        return {
          error: `Package set "${meta.packageSet}" not found. Run seed-volume.sh first.`,
        }
      }
    }
  }

  // Check for duplicate
  const existing = await db.project.findUnique({
    where: { userId_name: { userId: user.id, name: parsed.data.name } },
  })
  if (existing) return { error: 'Project already exists' }

  // Create project in DB
  const project = await db.project.create({
    data: {
      id: crypto.randomUUID(),
      userId: user.id,
      name: parsed.data.name,
      template: parsed.data.template,
    },
    select: { id: true, name: true, isPublic: true, template: true, createdAt: true },
  })

  // Create workspace directory and seed template files
  const workspace = path.join(getWorkspacesDir(), user.name, project.id)
  fs.mkdirSync(workspace, { recursive: true })

  if (parsed.data.template !== 'blank') {
    const templateDir = path.join(getTemplatesDir(), parsed.data.template)
    for (const file of TEMPLATE_FILES) {
      const src = path.join(templateDir, file)
      const dst = path.join(workspace, file)
      if (!fs.existsSync(dst) && fs.existsSync(src)) {
        fs.copyFileSync(src, dst)
      }
    }

    const meta = readTemplateMetadata(templateDir)
    const packageSet = meta?.packageSet
    if (packageSet) {
      fs.mkdirSync(path.join(workspace, '.lake', 'packages'), { recursive: true })
      await db.projectPackageSet.create({
        data: { projectId: project.id, packageSet },
      })
    }
  }

  return { ok: project }
}

async function requireProjectOwner(projectId: string): Promise<ActionResponse<Project>> {
  const session = await requireAuth()
  const project = await getDb().project.findUnique({ where: { id: projectId } })
  if (!project) {
    return { error: 'Project not found' }
  }
  if (project.userId !== session.user.id) forbidden()
  return { ok: project }
}

const zUpdateProject = z.object({
  projectId: z.string().min(1),
  name: zProjectName,
})

export async function renameProject(projectId: string, name: string): Promise<ActionResponse> {
  const parsed = zUpdateProject.safeParse({ projectId, name })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const owned = await requireProjectOwner(parsed.data.projectId)
  if ('error' in owned) return owned
  const project = owned.ok

  const db = getDb()

  // Check for name collision
  if (name !== project.name) {
    const existing = await db.project.findUnique({
      where: { userId_name: { userId: project.userId, name: parsed.data.name } },
    })
    if (existing) return { error: 'A project with that name already exists' }
  }

  // No need to rename on-disk directory: we use the UUID there
  await db.project.update({
    where: { id: project.id },
    data: { name: parsed.data.name },
  })

  return { ok: undefined }
}

const zDeleteProject = z.object({
  projectId: z.string().min(1),
})

export async function deleteProject(projectId: string): Promise<ActionResponse> {
  const parsed = zDeleteProject.safeParse({ projectId })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const owned = await requireProjectOwner(parsed.data.projectId)
  if ('error' in owned) return owned
  const project = owned.ok

  await getDb().project.delete({ where: { id: project.id } })

  return { ok: undefined }
}

const zToggleVisibility = z.object({
  projectId: z.string().min(1),
  isPublic: z.boolean(),
})

export async function toggleVisibility(projectId: string, isPublic: boolean): Promise<ActionResponse> {
  const parsed = zToggleVisibility.safeParse({ projectId, isPublic })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const owned = await requireProjectOwner(parsed.data.projectId)
  if ('error' in owned) return owned
  const project = owned.ok

  await getDb().project.update({
    where: { id: project.id },
    data: { isPublic: parsed.data.isPublic },
  })

  return { ok: undefined }
}
