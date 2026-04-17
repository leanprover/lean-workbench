'use client'

import { useServerAction } from '@/lib/util'
import { useRouter } from 'next/navigation'
import { startTransition } from 'react'
import type { EditorSessionInfo } from '@/lib/server/editorSessions'
import { killEditorSession } from '../actions'

type SessionEntry = { key: string; info: EditorSessionInfo; alive: boolean }

export function SessionRow({ entry }: { entry: SessionEntry }) {
  const router = useRouter()
  const [user] = entry.key.split('/')
  const [error, killAction, pending] = useServerAction(
    () => killEditorSession(user, entry.info.projectId),
    () => router.refresh(),
  )

  return (
    <li>
      <div className='info'>
        <a href={`/${user}/`}>{user}</a>
        <span style={{ color: '#90a4ae', margin: '0 0.25rem' }}>/</span>
        <span style={{ fontSize: '0.85rem', color: '#666' }}>{entry.info.projectId.slice(0, 8)}</span>
      </div>
      <div className='actions'>
        <span style={{ fontSize: '0.8rem', color: '#90a4ae' }}>port {entry.info.port}</span>
        <button className='delete' disabled={pending} onClick={() => startTransition(killAction)}>
          Kill
        </button>
      </div>
      {error && <div style={{ color: '#dc2626', fontSize: 13 }}>{error}</div>}
    </li>
  )
}
