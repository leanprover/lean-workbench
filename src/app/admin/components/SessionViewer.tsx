import { getEditorSessionManager } from '@/lib/server/editorSessions'
import { requireAdmin } from '../actions'
import { SessionRow } from './SessionRow'

export async function SessionViewer() {
  await requireAdmin()
  const sessions = getEditorSessionManager()
    .listSessions()
    .filter(s => s.alive)
  return (
    <section>
      <h2>Active editor sessions</h2>
      {sessions.length === 0 ? (
        <p className='empty'>No active editor sessions.</p>
      ) : (
        <ul className='project-list'>
          {sessions.map(entry => (
            <SessionRow key={entry.key} entry={entry} />
          ))}
        </ul>
      )}
    </section>
  )
}
