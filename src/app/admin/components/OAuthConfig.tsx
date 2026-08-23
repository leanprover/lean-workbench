'use client'

import { useState } from 'react'

import { fetchOAuthConfig, updateOAuthConfig } from '@/app/admin/actions'
import { useServerAction, useThrowingSWR } from '@/lib/client/util'

export function OAuthConfig() {
  const { data, mutate } = useThrowingSWR('adminOAuthConfig', () => fetchOAuthConfig())

  const [editing, setEditing] = useState(false)

  const [error, action, pending] = useServerAction(updateOAuthConfig, () => {
    setEditing(false)
    void mutate()
  })

  return (
    <section>
      <h2>OAuth Configuration</h2>
      {!data ? (
        <p>Loading...</p>
      ) : editing ? (
        <form action={action} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label>
            Client ID
            <input
              type='text'
              name='clientId'
              defaultValue={data.clientId}
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
      ) : (
        <div>
          <p style={{ fontSize: '0.9rem', margin: '4px 0' }}>
            <strong>Client ID:</strong> {data.clientId || <em>not configured</em>}
          </p>
          <button onClick={() => setEditing(true)} style={{ marginTop: 8 }}>
            Edit
          </button>
        </div>
      )}
    </section>
  )
}
