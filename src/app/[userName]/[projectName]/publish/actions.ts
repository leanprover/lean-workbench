'use server'

import { zProjectName, zUserName } from '@leanprover/workbench-shared'
import { getProjectDir } from '@leanprover/workbench-shared/node'
import z from 'zod'

import { getConfig, isPublishingEnabled } from '@/lib/server/config'
import { deletePublications, startPublish } from '@/lib/server/publish'
import { requireProjectOwner, serverAction, submitAction } from '@/lib/server/util'
import { detectViews } from '@/lib/server/views'
import { type ActionResponse } from '@/lib/util'

const zPublishTarget = z.object({
  userName: zUserName,
  projectName: zProjectName,
  kind: z.string(),
})

/** Build and publish one of the project's declared views. */
export const startPublishing = submitAction(
  zPublishTarget,
  async ({ userName, projectName, kind }): Promise<ActionResponse<boolean>> => {
    if (!isPublishingEnabled(getConfig())) return { error: 'Publishing is not configured on this server.' }

    const { owner, project } = await requireProjectOwner(userName, projectName)
    const manifest = await detectViews(getProjectDir(owner, project.id))
    if (manifest.type === 'missing') return { error: 'This project no longer declares anything to publish.' }
    if (manifest.type === 'invalid') return { error: manifest.error }

    const view = manifest.views.find(v => v.id === kind)
    if (!view) return { error: `This project does not declare a '${kind}' view.` }
    if ('error' in view) return { error: view.error }

    return startPublish(owner, project, kind, view.plan)
  },
)

/** Take a publication out of service and remove its files. */
export const unpublish = serverAction(zPublishTarget, async ({ userName, projectName, kind }) => {
  const { project } = await requireProjectOwner(userName, projectName)
  await deletePublications({ projectId: project.id, kind })
  return { ok: undefined }
})
