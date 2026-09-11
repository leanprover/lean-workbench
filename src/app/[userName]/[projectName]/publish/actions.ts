'use server'

import { zProjectName, zUserName } from '@leanprover/workbench-shared'
import { getProjectDir } from '@leanprover/workbench-shared/node'
import z from 'zod'

import { detectPublishable } from '@/lib/server/artefacts'
import { deletePublications, startPublish } from '@/lib/server/publish'
import { requireProjectOwner, serverAction, submitAction } from '@/lib/server/util'
import { type ActionResponse } from '@/lib/util'

const zPublishTarget = z.object({
  userName: zUserName,
  projectName: zProjectName,
  kind: z.string(),
})

/** Build and publish one of the project's declared artefacts.
 *
 * The manifest is read again here rather than trusted from the page:
 * it may have changed since the page was rendered,
 * and the build plan decides what runs in the sandbox. */
export const startPublishing = submitAction(
  zPublishTarget,
  async ({ userName, projectName, kind }): Promise<ActionResponse<boolean>> => {
    const { owner, project } = await requireProjectOwner(userName, projectName)
    const manifest = await detectPublishable(getProjectDir(owner, project.id))
    if (manifest.type === 'missing') return { error: 'This project no longer declares anything to publish.' }
    if (manifest.type === 'invalid') return { error: manifest.error }

    const artefact = manifest.artefacts.find(a => a.id === kind)
    if (!artefact) return { error: `This project does not declare a '${kind}' artefact.` }
    if ('error' in artefact) return { error: artefact.error }

    return startPublish(owner, project, kind, artefact.plan)
  },
)

/** Take a publication out of service and remove its files. */
export const unpublish = serverAction(zPublishTarget, async ({ userName, projectName, kind }) => {
  const { project } = await requireProjectOwner(userName, projectName)
  await deletePublications({ projectId: project.id, kind })
  return { ok: undefined }
})
