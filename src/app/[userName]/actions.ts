'use server'

import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { zProjectId, zTemplateId, zValidateProjectName } from '@leanprover/workbench-shared'
import {
  execFileAsync,
  existsAsync,
  getPackageSetsDir,
  getProjectDir,
  getTemplatesDir,
  getWorkspacesDir,
  makeTempBuildDir,
} from '@leanprover/workbench-shared/node'
import { forbidden } from 'next/navigation'
import z from 'zod'

import { requireAuth } from '@/lib/server/auth'
import { getDb } from '@/lib/server/db'
import { listInstalledToolchains } from '@/lib/server/elan'
import { readTemplateMetadata } from '@/lib/server/projectTemplate'
import { deletePublications } from '@/lib/server/publish'
import { serverAction, submitAction } from '@/lib/server/util'
import { type ActionResponse } from '@/lib/util'
import { type Project } from '@/prisma/generated/client'

export interface ProjectInfo {
  id: string
  name: string
  isPublic: boolean
}

// --- Mutations ---

export const createProjectFromArchive = submitAction(
  z.object({
    nameSuggestion: zValidateProjectName,
    projectName: zValidateProjectName.optional(),
    archive: z.instanceof(File),
  }),
  async ({ archive, nameSuggestion, projectName }) => {
    if (archive.name.endsWith('.lean')) {
      return { error: 'This form expects a .zip or .tar archive, not a .lean file' }
    }

    const name = projectName ?? nameSuggestion
    const session = await requireAuth()

    let tmpdir: string | null = null
    try {
      tmpdir = await makeTempBuildDir('projectFromArchive')
      const inDir = path.join(tmpdir, 'in')
      const outDir = path.join(tmpdir, 'out')
      const inFile = 'archive' + (archive.name.match(/\.[a-zA-Z0-9.]{1,16}$/)?.[0] ?? '')

      await Promise.all([fs.mkdir(inDir), fs.mkdir(outDir)])
      await fs.writeFile(path.join(inDir, inFile), archive.stream())

      // Extract uploaded archive
      try {
        await execFileAsync(
          'bwrap',
          /* prettier-ignore */ [
          '--ro-bind', '/usr', '/usr',
          '--ro-bind', '/lib', '/lib',
          '--ro-bind', path.join(tmpdir, "in"), "/in",
          '--uid', '1000', '--gid', '1000',
          '--bind', path.join(tmpdir, "out"), "/out",
          '--unshare-all', '--die-with-parent', '--new-session', '--clearenv',
          '--', '/usr/bin/bsdtar', '-xf', path.join("/in", inFile), '-C', '/out',
                '--exclude', '__MACOSX', '--exclude', '.DS_Store', '--exclude', '.lake'],
        )
      } catch (err) {
        return {
          error: `The uploaded file could not be extracted as a .zip or .tar archive\n${err instanceof Error ? err.message : String(err)}`,
        }
      }

      // Find directory that contains a lean-toolchain file
      let projDir: string | null = null
      const outDirContents = await fs.readdir(outDir)
      if (outDirContents.some(s => s === 'lean-toolchain')) {
        projDir = outDir
      } else {
        for (const fileInDir of outDirContents) {
          const subDir = path.join(outDir, fileInDir)
          if ((await fs.stat(subDir)).isDirectory()) {
            projDir = subDir
            break
          }
        }
      }
      if (!projDir) return { error: 'Could not find lean-toolchain file in repository or subdirectories' }
      const toolchain = (await fs.readFile(path.join(projDir, 'lean-toolchain'), { encoding: 'utf-8' })).trim()
      if (!(await listInstalledToolchains()).some(tc => tc === toolchain)) {
        return {
          error: `The uploaded file uses the toolchain ${toolchain}, but the workbench does not have this toolchain installed.`,
        }
      }

      // Create project
      const projectId = crypto.randomUUID()
      const projectDir = getProjectDir(session.user, projectId)
      try {
        await fs.mkdir(path.join(getWorkspacesDir(), session.user.id), { recursive: true })
        await fs.rename(outDir, projectDir)
        const project = await getDb().project.create({
          data: { id: projectId, userId: session.user.id, name },
          select: { id: true, name: true, isPublic: true, template: true, createdAt: true },
        })
        return { ok: project }
      } catch (err) {
        await getDb().project.deleteMany({ where: { id: projectId } })
        await fs.rm(projectDir, { recursive: true, force: true })
        return { error: `Error creating project workspace: ${err instanceof Error ? err.message : String(err)}` }
      }
    } finally {
      if (tmpdir !== null) await fs.rm(tmpdir, { recursive: true, force: true })
    }
  },
)

const zCreateProjectFromTemplate = z.object({
  nameSuggestion: zValidateProjectName,
  projectName: zValidateProjectName.optional(),
  template: zTemplateId,
})

export const createProjectFromTemplate = submitAction(
  zCreateProjectFromTemplate,
  async ({ projectName, nameSuggestion, template }): Promise<ActionResponse<ProjectInfo>> => {
    const name = projectName ?? nameSuggestion
    const session = await requireAuth()

    const db = getDb()
    const user = session.user

    // Validate template exists
    const { packageSet } = await readTemplateMetadata(template)
    if (packageSet) {
      const packagesFile = path.join(getPackageSetsDir(), packageSet, 'packages.txt')
      if (!(await existsAsync(packagesFile))) {
        throw new Error(`Package set "${packageSet}" not found. Run seed-volume.sh first.`)
      }
    }

    // Check for duplicate
    const existing = await db.project.findUnique({
      where: { userId_name: { userId: user.id, name } },
    })
    if (existing) return { error: 'A project with that name already exists' }

    // Create workspace directory and seed template files
    const projectId = crypto.randomUUID()
    const workspace = getProjectDir(user, projectId)
    await fs.mkdir(workspace, { recursive: true })

    const templateDir = path.join(getTemplatesDir(), template)
    // Copy template directory except for metadata.json
    await fs.cp(templateDir, workspace, { recursive: true, verbatimSymlinks: true })
    await fs.rm(path.join(workspace, 'metadata.json'), { force: true })

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

async function requireUserOwnsProjectById(projectId: string): Promise<ActionResponse<Project>> {
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
  const owned = await requireUserOwnsProjectById(projectId)
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
  const owned = await requireUserOwnsProjectById(projectId)
  if ('error' in owned) return owned
  const project = owned.ok

  await deletePublications({ projectId: project.id })
  await getDb().project.delete({ where: { id: project.id } })

  return { ok: undefined }
})

const zToggleVisibility = z.object({
  projectId: zProjectId,
  isPublic: z.boolean(),
})

export const toggleVisibility = serverAction(zToggleVisibility, async ({ projectId, isPublic }) => {
  const owned = await requireUserOwnsProjectById(projectId)
  if ('error' in owned) return owned
  const project = owned.ok

  await getDb().project.update({
    where: { id: project.id },
    data: { isPublic },
  })

  return { ok: undefined }
})
