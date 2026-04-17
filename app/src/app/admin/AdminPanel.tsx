'use client'

import { useEffect, useState } from 'react'
import {
  fetchHealth,
  fetchOAuthConfig,
  fetchRegistrationMode,
  listAllowedUsers,
  listEditorSessions,
  listUsers,
} from './actions'
import { AccessControl } from './components/AccessControl'
import { HealthMonitor } from './components/HealthMonitor'
import { OAuthConfig } from './components/OAuthConfig'
import { SessionViewer } from './components/SessionViewer'
import type { HealthInfo, SessionEntry, User } from './components/types'
import { UserManagement } from './components/UserManagement'

export function AdminPanel({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<User[]>([])
  const [oauthConfig, setOauthConfig] = useState({ clientId: '' })
  const [sessions, setSessions] = useState<SessionEntry[]>([])
  const [registrationMode, setRegMode] = useState('open')
  const [allowedUsers, setAllowedUsers] = useState<string[]>([])
  const [health, setHealth] = useState<HealthInfo | null>(null)

  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      listUsers(),
      fetchOAuthConfig(),
      listEditorSessions(),
      fetchRegistrationMode(),
      listAllowedUsers(),
      fetchHealth(),
    ])
      .then(([users, oauth, sessions, mode, allowed, health]) => {
        setUsers(users)
        setOauthConfig(oauth)
        setSessions(sessions)
        setRegMode(mode)
        setAllowedUsers(allowed)
        setHealth(health)
      })
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className='admin-page'>
        <h1>Admin</h1>
        <p>Loading...</p>
      </div>
    )
  }

  function handleError(msg: string) {
    setError(msg || null)
  }

  return (
    <div className='admin-page'>
      <h1>Admin</h1>

      {error && <div style={{ color: '#dc2626', marginBottom: 16 }}>{error}</div>}

      <UserManagement users={users} currentUserId={currentUserId} onUsersChange={setUsers} />

      <OAuthConfig initialConfig={oauthConfig} onError={handleError} />

      <SessionViewer initialSessions={sessions} onError={handleError} />

      <AccessControl initialMode={registrationMode} initialAllowedUsers={allowedUsers} onError={handleError} />

      {health && <HealthMonitor initialHealth={health} />}
    </div>
  )
}
