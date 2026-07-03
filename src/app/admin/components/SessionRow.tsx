'use client'

import { killEditorSession } from '@/app/admin/actions'
import ProjectLink from '@/app/components/ProjectLink'
import { useServerAction } from '@/lib/client/util'
import type { EditorSessionInfo } from '@/lib/server/editorSessions'
import { useRouter } from 'next/navigation'
import { startTransition } from 'react'

export function SessionRow({ info }: { info: EditorSessionInfo }) {
  const router = useRouter()
  const [killError, killAction, killPending] = useServerAction(
    () => killEditorSession({ projectId: info.projectId, sessionId: info.sessionId }),
    () => router.refresh(),
  )

  return (
    <li>
      <div className='info'>
        <a href={`/${info.viewerUsername}`}>{info.viewerUsername}</a>
        <span style={{ color: '#90a4ae', margin: '0 0.25rem' }}>editing</span>
        <ProjectLink ownerUsername={info.ownerUsername} projectName={info.projectName} />
      </div>
      <div className='actions'>
        <span style={{ fontSize: '0.8rem', color: '#90a4ae' }}>UUID {info.sessionId}</span>
        <button className='delete' disabled={killPending} onClick={() => startTransition(killAction)}>
          Kill
        </button>
      </div>
      {killError && <div style={{ color: '#dc2626', fontSize: 13 }}>{killError}</div>}
    </li>
  )
}
