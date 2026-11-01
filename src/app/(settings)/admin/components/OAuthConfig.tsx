'use client'

import { useRouter } from 'next/navigation'
import { use, useState } from 'react'

import { updateOAuthConfig } from '@/app/admin/actions'
import CatchySuspense from '@/app/components/CatchySuspense'
import { useServerAction } from '@/lib/client/util'

interface OAuthConfigProps {
  oauthConfigPromise: Promise<{ clientId: string }>
  baseUrl: string
}

export function OAuthConfig(props: OAuthConfigProps) {
  return (
    <section>
      <h2>OAuth Configuration</h2>
      <CatchySuspense loading='Loading…'>
        <OAuthConfigForm {...props} />
      </CatchySuspense>
    </section>
  )
}

function OAuthConfigForm(props: OAuthConfigProps) {
  const oauthConfig = use(props.oauthConfigPromise)
  const router = useRouter()

  const [editing, setEditing] = useState(false)

  const [error, action, pending] = useServerAction(updateOAuthConfig, () => {
    setEditing(false)
    router.refresh()
  })

  if (!editing) {
    return (
      <div>
        {oauthConfig.clientId === '' ? (
          <p style={{ fontSize: '0.9rem', margin: '4px 0', color: '#dc2626' }}>
            <strong>Client ID not configured!</strong>{' '}
            <em>Some workbench features will not work until github authorization is configured.</em>
          </p>
        ) : (
          <p style={{ fontSize: '0.9rem', margin: '4px 0' }}>
            <strong> Client ID:</strong> <em>{oauthConfig.clientId}</em>
          </p>
        )}
        <button onClick={() => setEditing(true)} style={{ marginTop: 8 }}>
          Edit
        </button>
      </div>
    )
  }

  return (
    <form action={action} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ color: '#607D8B', fontSize: '13px' }}>
        <p>
          Create a{' '}
          <a href='https://github.com/settings/developers' target='_blank' rel='noreferrer'>
            New OAuth App on GitHub
          </a>
          :
        </p>
        <ul style={{ marginLeft: '1em' }}>
          <li>
            The &ldquo;Application Name&rdquo; can be anything (e.g. &lsquo;My Lean Workbench&rsquo;). When a user first
            uses GitHub to sign in, they will see this name as the application that wants access to their profile and
            email address.
          </li>
          <li>
            The &ldquo;Homepage URL&rdquo; should be
            <br />
            <code style={{ whiteSpace: 'nowrap' }}>{`${props.baseUrl}`}</code>
          </li>
          <li>
            The &ldquo;Redirect URI&rdquo; should be
            <br />
            <code style={{ whiteSpace: 'nowrap' }}>{`${props.baseUrl}/api/auth/callback/github`}</code>
          </li>
        </ul>

        <p style={{ color: '#607D8B', fontSize: '13px' }}>
          Once you register the application you can create a client secret. Enter the client ID and client secret here.
        </p>
      </div>
      <label>
        Client ID
        <input
          type='text'
          name='clientId'
          defaultValue={oauthConfig.clientId}
          required
          style={{ width: '100%', marginTop: 4 }}
        />
      </label>
      <label>
        Client Secret
        <input
          type='password'
          name='clientSecret'
          placeholder='Leave empty to keep current'
          style={{ width: '100%', marginTop: 4 }}
        />
      </label>
      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <button type='submit' disabled={pending}>
          {pending ? 'Saving...' : 'Save'}
        </button>
        <button type='button' onClick={() => setEditing(false)} disabled={pending}>
          Cancel
        </button>
      </div>
      {error && <div style={{ color: '#dc2626', fontSize: 13 }}>{error}</div>}
    </form>
  )
}
