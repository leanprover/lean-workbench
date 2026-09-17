'use server'

import { zProjectName, zUserName } from '@leanprover/workbench-shared'
import { getProjectDir } from '@leanprover/workbench-shared/node'
import z from 'zod'

import { detectPublishable } from '@/lib/server/artifacts'
import { deletePublications, startPublish } from '@/lib/server/publish'
import { requireProjectOwner, serverAction, submitAction } from '@/lib/server/util'
import { type ActionResponse } from '@/lib/util'

const zPublishTarget = z.object({
  userName: zUserName,
  projectName: zProjectName,
  kind: z.string(),
})

/** Build and publish one of the project's declared artifacts. */
export const startPublishing = submitAction(
  zPublishTarget,
  async ({ userName, projectName, kind }): Promise<ActionResponse<boolean>> => {
    const { owner, project } = await requireProjectOwner(userName, projectName)
    const manifest = await detectPublishable(getProjectDir(owner, project.id))
    if (manifest.type === 'missing') return { error: 'This project no longer declares anything to publish.' }
    if (manifest.type === 'invalid') return { error: manifest.error }

    const artifact = manifest.artifacts.find(a => a.id === kind)
    if (!artifact) return { error: `This project does not declare a '${kind}' artifact.` }
    if ('error' in artifact) return { error: artifact.error }

    return startPublish(owner, project, kind, artifact.plan)
  },
)

/** Take a publication out of service and remove its files. */
export const unpublish = serverAction(zPublishTarget, async ({ userName, projectName, kind }) => {
  const { project } = await requireProjectOwner(userName, projectName)
  await deletePublications({ projectId: project.id, kind })
  return { ok: undefined }
})
