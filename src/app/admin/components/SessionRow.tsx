'use client'

import { ConfigCtx } from '@/lib/contexts'
import type { EditorSessionInfo } from '@/lib/server/editorSessions'
import { useServerAction } from '@/lib/util'
import { useRouter } from 'next/navigation'
import { startTransition, use } from 'react'
import { debugEditorSession, killEditorSession } from '../actions'

export function SessionRow({ info }: { info: EditorSessionInfo }) {
  const router = useRouter()
  const cfg = use(ConfigCtx)
  const [killError, killAction, killPending] = useServerAction(
    () => killEditorSession(info.viewerId, info.projectId),
    () => router.refresh(),
  )
  const [debugError, debugAction, debugPending] = useServerAction(
    () => debugEditorSession(info.viewerId, info.projectId),
    () => router.refresh(),
  )

  const error = killError && debugError
  return (
    <li>
      <div className='info'>
        <a href={`/${info.viewerUsername}`}>{info.viewerUsername}</a>
        <span style={{ color: '#90a4ae', margin: '0 0.25rem' }}>editing</span>
        <a href={`/${info.ownerUsername}`}>{info.ownerUsername}</a>
        <span style={{ color: '#90a4ae', margin: '0 0.25rem' }}>/</span>
        <a href={`/${info.ownerUsername}/${info.projectName}`}>{info.projectName}</a>
      </div>
      <div className='actions'>
        <span style={{ fontSize: '0.8rem', color: '#90a4ae' }}>port {info.port}</span>
        <button className='delete' disabled={killPending} onClick={() => startTransition(killAction)}>
          Kill
        </button>
        {cfg.isDevMode && (
          <button disabled={debugPending} onClick={() => startTransition(debugAction)}>
            [DEV] Debug
          </button>
        )}
      </div>
      {error && <div style={{ color: '#dc2626', fontSize: 13 }}>{error}</div>}
    </li>
  )
}
