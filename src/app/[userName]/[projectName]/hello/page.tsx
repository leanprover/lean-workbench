import { bwrapProjectDir, zProjectName, zUserName } from '@leanprover/workbench-shared'
import { notFound } from 'next/navigation'
import { connection } from 'next/server'
import z from 'zod'

import { getEditorSessionManager } from '@/lib/server/editorSessions'
import { requireProjectAccess } from '@/lib/server/util'

import HelloClient from './HelloClient'

const zParams = z.object({
  userName: zUserName,
  projectName: zProjectName,
})

type Params = z.infer<typeof zParams>

export default async function HelloView({ params: params_ }: { params: Promise<Params> }) {
  // Suspend during pre-rendering and on <Link> prefetches
  // instead of running this (expensive) handler.
  await connection()

  const parsed = zParams.safeParse(await params_)
  if (!parsed.success) notFound()
  const params = parsed.data
  const { viewer, owner, project } = await requireProjectAccess(params.userName, params.projectName)

  // May throw to the error boundary (e.g. if the project folder isn't accessible).
  const viewUrl = await getEditorSessionManager().ensureView(viewer, owner, project)

  return (
    <HelloClient
      viewUrl={viewUrl}
      projectDir={bwrapProjectDir(project.name)}
      userName={params.userName}
      projectName={params.projectName}
    />
  )
}
