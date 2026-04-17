'use client'

import { useState } from 'react'
import { killEditorSession } from '../actions'
import type { SessionEntry } from './types'

export function SessionViewer({
  initialSessions,
  onError,
}: {
  initialSessions: SessionEntry[]
  onError: (msg: string) => void
}) {
  const [sessions, setSessions] = useState(initialSessions)
  const aliveSessions = sessions.filter(s => s.alive)

  async function handleKillSession(entry: SessionEntry) {
    const [viewer] = entry.key.split('/')
    onError('')
    const result = await killEditorSession(viewer, entry.info.projectId)
    if ('error' in result) {
      onError(result.error)
    } else {
      setSessions(prev => prev.filter(s => s.key !== entry.key))
    }
  }

  return (
    <section>
      <h2>Active editor sessions</h2>
      {aliveSessions.length === 0 ? (
        <p className='empty'>No active editor sessions.</p>
      ) : (
        <ul className='project-list'>
          {aliveSessions.map(entry => {
            const [user] = entry.key.split('/')
            return (
              <li key={entry.key}>
                <div className='info'>
                  <a href={`/${user}/`}>{user}</a>
                  <span style={{ color: '#90a4ae', margin: '0 0.25rem' }}>/</span>
                  <span style={{ fontSize: '0.85rem', color: '#666' }}>{entry.info.projectId.slice(0, 8)}</span>
                </div>
                <div className='actions'>
                  <span style={{ fontSize: '0.8rem', color: '#90a4ae' }}>port {entry.info.port}</span>
                  <button className='delete' onClick={() => void handleKillSession(entry)}>
                    Kill
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
