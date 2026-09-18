'use client'

import { useRouter } from 'next/navigation'
import { startTransition } from 'react'

import ErrorBox from '@/app/components/ErrorBox'
import TrackedCommandForm from '@/app/components/TrackedCommandForm'
import { useServerAction } from '@/lib/client/util'

import { startPublishing, unpublish } from './actions'

export interface PublicationInfo {
  /** The URL this publication is linked by. */
  url: string
  /** The URL that keeps naming this publication across renames. */
  durableUrl: string
  /** When it was last built, formatted on the server so that it renders identically here. */
  publishedAt: string
}

interface PublishCardProps {
  userName: string
  projectName: string
  kind: string
  displayName: string
  /** What the manifest declares, or why its entry for this kind cannot be used. */
  detail: { description: string } | { error: string }
  /** Absent until the artifact has been published at least once. */
  publication?: PublicationInfo
  trackingKey: string
}

export function PublishCard({
  userName,
  projectName,
  kind,
  displayName,
  detail,
  publication,
  trackingKey,
}: PublishCardProps) {
  const router = useRouter()
  const [unpublishError, unpublishAction, unpublishPending] = useServerAction(unpublish, () => router.refresh())
  const broken = 'error' in detail

  return (
    <section className='publish-card'>
      <h3>{displayName}</h3>
      {broken ? <ErrorBox>{detail.error}</ErrorBox> : <p className='publish-card-detail'>{detail.description}</p>}

      {publication ? (
        <dl className='publish-card-urls'>
          <dt>Published at</dt>
          <dd>
            <a href={publication.url}>{publication.url}</a>
          </dd>
          <dt>Last built</dt>
          <dd>{publication.publishedAt}</dd>
        </dl>
      ) : (
        <p className='empty'>Not published yet.</p>
      )}

      <TrackedCommandForm
        streamCommandKey={trackingKey}
        scope='user'
        title={publication ? 'Publish again' : 'Publish'}
        disabled={broken}
        initiallyWatchingTTY
        trackedCommandAction={startPublishing}
        successAction={() => router.refresh()}
      >
        <input type='hidden' name='userName' value={userName} />
        <input type='hidden' name='projectName' value={projectName} />
        <input type='hidden' name='kind' value={kind} />
        <p>
          The project is built in a sandbox, and the document it generates replaces whatever is currently published.
          Building a Lean project can take a while.
        </p>
      </TrackedCommandForm>

      {publication && (
        <div className='actions'>
          <button
            className='delete'
            disabled={unpublishPending}
            onClick={() => {
              if (!confirm(`Stop serving ${publication.url}? The project itself is not affected.`)) return
              startTransition(() => unpublishAction({ userName, projectName, kind }))
            }}
          >
            Unpublish
          </button>
        </div>
      )}
      {unpublishError && <ErrorBox>{unpublishError}</ErrorBox>}
    </section>
  )
}
