import Error from '@/app/components/Error'
import { requireAuth } from '@/lib/server/actions'
import { getDb } from '@/lib/server/db'
import { getEditorSessionManager } from '@/lib/server/editorSessions'
import { canAccessProject } from '@/lib/server/util'
import { zProjectName, zUserName } from '@/lib/util'
import { notFound } from 'next/navigation'
import z from 'zod'

const zParams = z.object({
  userName: zUserName,
  projectName: zProjectName,
})

type Params = z.infer<typeof zParams>

export default async function EditorSession({ params: params_ }: { params: Promise<Params> }) {
  const parsed = zParams.safeParse(await params_)
  // 400 would be better, but RSCs can't return a Response and there is no 400 helper in Next.js.
  if (!parsed.success) notFound()
  const params = parsed.data

  const session = await requireAuth()
  const viewer = session.user

  const db = getDb()
  const owner = await db.user.findUnique({
    where: { name: params.userName },
  })
  if (!owner) notFound()

  const project = await db.project.findUnique({
    where: { userId_name: { userId: owner.id, name: params.projectName } },
  })
  if (!project || !canAccessProject(viewer, project)) notFound()

  const manager = getEditorSessionManager()
  let iframeSrc = null
  try {
    iframeSrc = await manager.ensureSession(viewer, owner, project)
  } catch (err) {
    console.error('Failed to start editor session:', (err as Error).message)
    return <Error>Failed to start editor session: {String(err)}</Error>
  }

  return <iframe id='editor-frame' src={iframeSrc} className='editor-session-iframe' />
}
