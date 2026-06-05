'use server'

import { requireAuth } from '@/lib/server/auth'
import { getPackageSetsDir, getTemplatesDir, getWorkspacesDir } from '@/lib/server/config'
import { getDb } from '@/lib/server/db'
import { existsAsync, serverAction } from '@/lib/server/util'
import { zProjectId, zProjectName, zTemplateId, type ActionResponse } from '@/lib/util'
import { Project } from '@/prisma/generated/client'
import { forbidden } from 'next/navigation'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import z from 'zod'

const zTemplateMetadata = z.object({
  name: z.string(),
  description: z.string().optional(),
  packageSet: z.string().optional(),
})

type TemplateMetadata = z.infer<typeof zTemplateMetadata>

async function readTemplateMetadata(templateDir: string): Promise<TemplateMetadata | null> {
  const metaPath = path.join(templateDir, 'metadata.json')
  const raw = await fs.readFile(metaPath, 'utf-8').catch(() => null)
  if (raw === null) return null
  return zTemplateMetadata.parse(JSON.parse(raw))
}

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
  const entries = await fs.readdir(templatesDir, { withFileTypes: true }).catch(() => [])

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const meta = await readTemplateMetadata(path.join(entry.parentPath, entry.name))
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

export const createProject = serverAction(
  zCreateProject,
  async ({ name, template }): Promise<ActionResponse<ProjectInfo>> => {
    const session = await requireAuth()

    const db = getDb()
    const user = session.user

    // Validate template exists
    if (template !== 'blank') {
      const templateDir = path.join(getTemplatesDir(), template)
      const meta = await readTemplateMetadata(templateDir)
      if (!meta) return { error: `Template "${template}" not found` }
      if (meta.packageSet) {
        const packagesFile = path.join(getPackageSetsDir(), meta.packageSet, 'packages.txt')
        if (!(await existsAsync(packagesFile))) {
          return {
            error: `Package set "${meta.packageSet}" not found. Run seed-volume.sh first.`,
          }
        }
      }
    }

    // Check for duplicate
    const existing = await db.project.findUnique({
      where: { userId_name: { userId: user.id, name } },
    })
    if (existing) return { error: 'A project with that name already exists' }

    // Create workspace directory and seed template files
    const projectId = crypto.randomUUID()
    const workspace = path.join(getWorkspacesDir(), user.name, projectId)
    await fs.mkdir(workspace, { recursive: true })

    let packageSet: string | undefined
    if (template !== 'blank') {
      const templateDir = path.join(getTemplatesDir(), template)
      // Copy template directory except for metadata.json
      await fs.cp(templateDir, workspace, { recursive: true })
      await fs.rm(path.join(workspace, 'metadata.json'), { force: true })

      const meta = await readTemplateMetadata(templateDir)
      packageSet = meta?.packageSet
    }

    // Store project in DB
    const project = await db.project.create({
      data: {
        id: projectId,
        userId: user.id,
        name,
        template,
      },
      select: { id: true, name: true, isPublic: true, template: true, createdAt: true },
    })
    if (packageSet) {
      await db.projectPackageSet.create({
        data: { projectId, packageSet },
      })
    }

    return { ok: project }
  },
)

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
  projectId: zProjectId,
  name: zProjectName,
})

export const renameProject = serverAction(zUpdateProject, async ({ projectId, name }) => {
  const owned = await requireProjectOwner(projectId)
  if ('error' in owned) return owned
  const project = owned.ok

  const db = getDb()

  if (name === project.name) return { ok: undefined }

  // Check for name collision
  const existing = await db.project.findUnique({
    where: { userId_name: { userId: project.userId, name } },
  })
  if (existing && existing.id !== project.id) return { error: 'A project with that name already exists' }

  // Update the DB (no need to rename on-disk directory: we use the UUID there)
  await db.project.update({
    where: { id: project.id },
    data: { name },
  })

  return { ok: undefined }
})

const zDeleteProject = z.object({
  projectId: zProjectId,
})

export const deleteProject = serverAction(zDeleteProject, async ({ projectId }) => {
  const owned = await requireProjectOwner(projectId)
  if ('error' in owned) return owned
  const project = owned.ok

  await getDb().project.delete({ where: { id: project.id } })

  return { ok: undefined }
})

const zToggleVisibility = z.object({
  projectId: zProjectId,
  isPublic: z.boolean(),
})

export const toggleVisibility = serverAction(zToggleVisibility, async ({ projectId, isPublic }) => {
  const owned = await requireProjectOwner(projectId)
  if ('error' in owned) return owned
  const project = owned.ok

  await getDb().project.update({
    where: { id: project.id },
    data: { isPublic },
  })

  return { ok: undefined }
})
