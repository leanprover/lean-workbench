import { requireAdmin } from '@/app/admin/actions'
import { getEditorSessionManager } from '@/lib/server/editorSessions'
import { SessionRow } from './SessionRow'

export async function SessionViewer() {
  await requireAdmin()
  const sessions = await getEditorSessionManager().listSessions()
  return (
    <section>
      <h2>Active editor sessions</h2>
      {sessions.length === 0 ? (
        <p className='empty'>No active editor sessions.</p>
      ) : (
        <ul className='project-list'>
          {sessions.map(info => (
            <SessionRow key={`${info.viewerId}/${info.projectId}`} info={info} />
          ))}
        </ul>
      )}
    </section>
  )
}
