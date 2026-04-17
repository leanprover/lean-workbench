'use client'

import { useRef, useState } from 'react'
import { addAllowedUser, removeAllowedUser, setRegistrationMode } from '../actions'

export function AccessControl({
  initialMode,
  initialAllowedUsers,
  onError,
}: {
  initialMode: string
  initialAllowedUsers: string[]
  onError: (msg: string) => void
}) {
  const [registrationMode, setRegMode] = useState(initialMode)
  const [savedMode, setSavedMode] = useState(initialMode)
  const [saving, setSaving] = useState(false)
  const [allowedUsers, setAllowedUsers] = useState(initialAllowedUsers)
  const [newUser, setNewUser] = useState('')
  const newUserRef = useRef<HTMLInputElement>(null)

  const modeChanged = registrationMode !== savedMode

  async function handleSaveMode() {
    setSaving(true)
    onError('')
    try {
      const result = await setRegistrationMode(registrationMode)
      if ('error' in result) {
        onError(result.error)
      } else {
        setSavedMode(registrationMode)
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleAddUser() {
    const trimmed = newUser.trim().toLowerCase()
    if (!trimmed) return
    onError('')
    const result = await addAllowedUser(trimmed)
    if ('error' in result) {
      onError(result.error)
    } else {
      setAllowedUsers(prev => (prev.includes(trimmed) ? prev : [...prev, trimmed].sort()))
      setNewUser('')
      newUserRef.current?.focus()
    }
  }

  async function handleRemoveUser(u: string) {
    onError('')
    const result = await removeAllowedUser(u)
    if ('error' in result) {
      onError(result.error)
    } else {
      setAllowedUsers(prev => prev.filter(x => x !== u))
    }
  }

  return (
    <>
      <section>
        <h2>Access control</h2>
        <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input
              type='radio'
              name='regMode'
              value='open'
              checked={registrationMode === 'open'}
              onChange={() => setRegMode('open')}
            />
            Open registration
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input
              type='radio'
              name='regMode'
              value='restricted'
              checked={registrationMode === 'restricted'}
              onChange={() => setRegMode('restricted')}
            />
            Restricted (allowlist only)
          </label>
        </div>
        {modeChanged && (
          <button onClick={() => void handleSaveMode()} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        )}
      </section>

      <section>
        <h2>Allowed users</h2>
        <p style={{ fontSize: '0.9rem', color: '#666', marginBottom: 12 }}>
          GitHub usernames allowed to register when mode is &quot;restricted&quot;.
        </p>
        {allowedUsers.length === 0 ? (
          <p className='empty'>No users in the allowlist.</p>
        ) : (
          <ul className='project-list'>
            {allowedUsers.map(u => (
              <li key={u}>
                <div className='info'>{u}</div>
                <div className='actions'>
                  <button className='delete' onClick={() => void handleRemoveUser(u)}>
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <input
            ref={newUserRef}
            type='text'
            value={newUser}
            onChange={e => setNewUser(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') void handleAddUser()
            }}
            placeholder='GitHub username'
            style={{ flex: 1 }}
          />
          <button onClick={() => void handleAddUser()}>Add</button>
        </div>
      </section>
    </>
  )
}
