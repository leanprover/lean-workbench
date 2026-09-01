'use server'

import fs from 'node:fs/promises'
import path from 'node:path'

import { zProjectName, zUserName } from '@leanprover/workbench-shared'
import { getProjectDir } from '@leanprover/workbench-shared/node'
import z from 'zod'

import { requireProjectAccess } from '@/lib/server/util'

import { PROBE_FILE } from './probe'

const zArgs = z.object({ userName: zUserName, projectName: zProjectName })

/** Current contents of the project's context file, read live from the mount.
 *
 * The view fetches this on each LSP (re)connect rather than trusting a server-rendered
 * snapshot, so edits made in the editor (or while the page sat in the back/forward cache)
 * are reflected without a full reload. Absent file yields empty context. */
export async function getProbeContext(userName: string, projectName: string): Promise<string> {
  const args = zArgs.parse({ userName, projectName })
  const { owner, project } = await requireProjectAccess(args.userName, args.projectName)
  return fs.readFile(path.join(getProjectDir(owner.name, project.id), PROBE_FILE), 'utf-8').catch(() => '')
}
