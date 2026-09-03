'use server'

import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import { zProjectId, zTemplateId, zValidateProjectName } from '@leanprover/workbench-shared'
import { existsAsync, getPackageSetsDir, getTemplatesDir, getWorkspacesDir } from '@leanprover/workbench-shared/node'
import { forbidden } from 'next/navigation'
import z from 'zod'

import { requireAuth } from '@/lib/server/auth'
import { getDb } from '@/lib/server/db'
import { readTemplateMetadata, serverAction, submitAction } from '@/lib/server/util'
import { type ActionResponse } from '@/lib/util'
import { type Project } from '@/prisma/generated/client'

export interface ProjectInfo {
  id: string
  name: string
  isPublic: boolean
}

// --- Mutations ---

const zCreateProject = z.object({
  name: zValidateProjectName,
  template: zTemplateId.default('blank'),
})

export const createProject = submitAction(
  zCreateProject,
  async ({ name, template }): Promise<ActionResponse<ProjectInfo>> => {
    const session = await requireAuth()

    const db = getDb()
    const user = session.user

    // Validate template exists
    if (template !== 'blank') {
      const meta = await readTemplateMetadata(template)
      if (meta.packageSet) {
        const packagesFile = path.join(getPackageSetsDir(), meta.packageSet, 'packages.txt')
        if (!(await existsAsync(packagesFile))) {
          throw new Error(`Package set "${meta.packageSet}" not found. Run seed-volume.sh first.`)
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
    const workspace = path.join(getWorkspacesDir(), user.id, projectId)
    await fs.mkdir(workspace, { recursive: true })

    let packageSet: string | undefined
    if (template !== 'blank') {
      const templateDir = path.join(getTemplatesDir(), template)
      // Copy template directory except for metadata.json
      await fs.cp(templateDir, workspace, { recursive: true })
      await fs.rm(path.join(workspace, 'metadata.json'), { force: true })

      const meta = await readTemplateMetadata(template)
      packageSet = meta.packageSet
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
  name: zValidateProjectName,
})

export const renameProject = submitAction(zUpdateProject, async ({ projectId, name }) => {
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
