import { requireAuth } from '@/lib/server/actions'
import { getDb } from '@/lib/server/db'
import { getEditorSessionManager } from '@/lib/server/editorSessions'
import z from 'zod'

const zParams = z.object({
  userName: z.string().min(1),
  projectName: z.string().min(1),
})

function Error({ msg }: { msg: string }) {
  return (
    <div
      style={{
        background: '#fee',
        border: '1px solid #c00',
        color: '#900',
        padding: '0.75em 1em',
        borderRadius: '4px',
      }}
    >
      Failed to start editor session: {msg}
    </div>
  )
}

interface Params {
  userName: string
  projectName: string
}

export default async function EditorSession({ params: params_ }: { params: Promise<Params> }) {
  const parsed = zParams.safeParse(await params_)
  if (!parsed.success) return <Error msg={parsed.error.issues[0].message} />
  const params = parsed.data

  const session = await requireAuth()
  const viewer = session.user

  const db = getDb()
  const owner = await db.user.findUnique({
    where: { name: params.userName },
  })
  if (!owner) {
    return <Error msg='User not found' />
  }

  const project = await db.project.findUnique({
    where: { userId_name: { userId: owner.id, name: params.projectName } },
  })
  const isOwner = viewer.name === params.userName
  if (!project || (!isOwner && !project.isPublic)) {
    return <Error msg='Project not found' />
  }

  const manager = getEditorSessionManager()
  let iframeSrc = null
  try {
    iframeSrc = await manager.ensureSession(viewer, owner, project)
  } catch (err) {
    console.error('Failed to start editor session:', (err as Error).message)
    return <Error msg={String(err)} />
  }

  return <iframe id='editor-frame' src={iframeSrc} className='editor-session-iframe' />
}
