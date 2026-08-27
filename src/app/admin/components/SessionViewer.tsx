import { io } from 'next/cache'

import CatchySuspense from '@/app/components/CatchySuspense'
import { requireAdmin } from '@/lib/server/auth'
import { getEditorSessionManager } from '@/lib/server/editorSessions'

import { SessionRow } from './SessionRow'

export async function SessionViewer() {
  await requireAdmin()
  return (
    <section>
      <h2>Active editor sessions</h2>
      <CatchySuspense loading={<p>Loading active sessions&hellip;</p>}>
        <SessionViewerData />
      </CatchySuspense>
    </section>
  )
}

async function SessionViewerData() {
  await io()
  const sessions = await getEditorSessionManager().listSessions()
  return sessions.length === 0 ? (
    <p className='empty'>No active editor sessions.</p>
  ) : (
    <ul className='project-list'>
      {sessions.map(info => (
        <SessionRow key={`${info.viewerId}/${info.projectId}`} info={info} />
      ))}
    </ul>
  )
}
