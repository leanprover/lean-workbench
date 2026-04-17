'use client'

import { GithubAuthConfig } from '@/lib/server/config'
import { useState } from 'react'
import { updateOAuthConfig } from '../actions'

export function OAuthConfig({
  initialConfig,
  onError,
}: {
  initialConfig: { clientId: string }
  onError: (msg: string) => void
}) {
  const [oauthConfig, setOauthConfig] = useState(initialConfig)
  const [oauthEditing, setOauthEditing] = useState(false)
  const [oauthForm, setOauthForm] = useState<GithubAuthConfig>({ clientId: '', clientSecret: '' })
  const [oauthSaving, setOauthSaving] = useState(false)

  function handleOauthEdit() {
    setOauthForm({
      clientId: oauthConfig.clientId,
      clientSecret: '',
    })
    setOauthEditing(true)
  }

  async function handleOauthSave() {
    setOauthSaving(true)
    onError('')
    try {
      const result = await updateOAuthConfig(oauthForm.clientId, oauthForm.clientSecret || undefined)
      if ('error' in result) {
        onError(result.error)
      } else {
        setOauthConfig({ clientId: oauthForm.clientId })
        setOauthEditing(false)
      }
    } finally {
      setOauthSaving(false)
    }
  }

  return (
    <section>
      <h2>OAuth Configuration</h2>
      {oauthEditing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label>
            Client ID
            <input
              type='text'
              value={oauthForm.clientId}
              onChange={e => setOauthForm({ ...oauthForm, clientId: e.target.value })}
              style={{ width: '100%', marginTop: 4 }}
            />
          </label>
          <label>
            Client Secret
            <input
              type='password'
              value={oauthForm.clientSecret}
              onChange={e => setOauthForm({ ...oauthForm, clientSecret: e.target.value })}
              placeholder='Leave empty to keep current'
              style={{ width: '100%', marginTop: 4 }}
            />
          </label>
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button onClick={() => void handleOauthSave()} disabled={oauthSaving}>
              {oauthSaving ? 'Saving...' : 'Save'}
            </button>
            <button onClick={() => setOauthEditing(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div>
          <p style={{ fontSize: '0.9rem', margin: '4px 0' }}>
            <strong>Client ID:</strong> {oauthConfig.clientId || <em>not configured</em>}
          </p>
          <button onClick={handleOauthEdit} style={{ marginTop: 8 }}>
            Edit
          </button>
        </div>
      )}
    </section>
  )
}
