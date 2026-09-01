import { zProjectName, zUserName } from '@leanprover/workbench-shared'
import { notFound } from 'next/navigation'
import { connection } from 'next/server'
import z from 'zod'

import { getEditorSessionManager } from '@/lib/server/editorSessions'
import { requireProjectAccess } from '@/lib/server/util'

const zParams = z.object({
  userName: zUserName,
  projectName: zProjectName,
})

type Params = z.infer<typeof zParams>

export default async function EditorSession({ params: params_ }: { params: Promise<Params> }) {
  // Suspend during pre-rendering and on <Link> prefetches
  // instead of running this (expensive) handler.
  await connection()

  const parsed = zParams.safeParse(await params_)
  // 400 would be better, but RSCs can't return a Response and there is no 400 helper in Next.js.
  if (!parsed.success) notFound()
  const { viewer, owner, project } = await requireProjectAccess(parsed.data.userName, parsed.data.projectName)

  const manager = getEditorSessionManager()
  // may throw to error boundary (e.g. if the project folder isn't accessible)
  const iframeSrc = await manager.ensureSession(viewer, owner, project)

  // TODO: VSC should be sandboxed but can't be opaque-origin: need a subdomain.
  return <iframe id='editor-frame' src={iframeSrc} className='editor-session-iframe' />
}
