import { bwrapProjectDir, zProjectName, zUserName } from '@leanprover/workbench-shared'
import { notFound } from 'next/navigation'
import z from 'zod'

import { requireAuth } from '@/lib/server/auth'
import { getDb } from '@/lib/server/db'
import { getEditorSessionManager } from '@/lib/server/editorSessions'
import { canAccessProject } from '@/lib/server/util'

import HelloClient from './HelloClient'

const zParams = z.object({
  userName: zUserName,
  projectName: zProjectName,
})

type Params = z.infer<typeof zParams>

export default async function HelloView({ params: params_ }: { params: Promise<Params> }) {
  const parsed = zParams.safeParse(await params_)
  if (!parsed.success) notFound()
  const params = parsed.data

  const session = await requireAuth()
  const viewer = session.user

  const db = getDb()
  const owner = await db.user.findUnique({ where: { name: params.userName } })
  if (!owner) notFound()

  const project = await db.project.findUnique({
    where: { userId_name: { userId: owner.id, name: params.projectName } },
  })
  if (!project || !canAccessProject(viewer, project)) notFound()

  // May throw to the error boundary (e.g. if the project folder isn't accessible).
  const viewUrl = await getEditorSessionManager().ensureView(viewer, owner, project, 'hello')

  return (
    <HelloClient
      viewUrl={viewUrl}
      projectDir={bwrapProjectDir(project.name)}
      userName={params.userName}
      projectName={params.projectName}
    />
  )
}
