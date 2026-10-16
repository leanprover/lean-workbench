'use client'

import { useRouter } from 'next/navigation'
import { startTransition } from 'react'

import { killEditorSession } from '@/app/admin/actions'
import ProjectLink from '@/app/components/ProjectLink'
import { useServerAction } from '@/lib/client/util'
import type { EditorSessionInfo, UnknownEditorSession } from '@/lib/server/shardConnection'

export function SessionRow({ info }: { info: EditorSessionInfo | UnknownEditorSession }) {
  const router = useRouter()
  const [killError, killAction, killPending] = useServerAction(killEditorSession, () => router.refresh())

  return (
    <li>
      <div>
        <div>
          {'ownerUsername' in info ? (
            <ProjectLink ownerUsername={info.ownerUsername} projectName={info.projectName} />
          ) : (
            <div style={{ color: '#dc2626' }}>Unlisted (deleted?) project {info.projectId}</div>
          )}
        </div>
        <div className='subinfo'>
          <a href={`/${info.viewerUsername}`}>{info.viewerUsername}</a>
          <span> editing</span>
        </div>
      </div>
      <div className='secondary'>
        <div>
          <span>UUID {info.sessionId}</span>
        </div>
        <div className='subinfo'>
          <span>
            since{' '}
            {info.createdAt.toLocaleString('en-us', {
              month: 'long',
              day: 'numeric',
              hour: 'numeric',
              minute: 'numeric',
              hourCycle: 'h23',
              timeZone: 'UTC',
              timeZoneName: 'short',
            })}
          </span>
        </div>
      </div>
      <div className='actions'>
        <button
          className='delete'
          disabled={killPending}
          onClick={() => startTransition(() => killAction({ projectId: info.projectId, sessionId: info.sessionId }))}
        >
          Kill
        </button>
      </div>
      {killError && <div style={{ color: '#dc2626', fontSize: 13 }}>{killError}</div>}
    </li>
  )
}
