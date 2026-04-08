import { useEffect, useRef, useState } from 'react'
import type { AdminUser, EditorSessionStatus, HealthInfo, OAuthConfig } from './api'
import {
  addAllowedUser,
  deleteUser,
  fetchAdminSettings,
  fetchAllowedUsers,
  fetchDiskUsage,
  fetchHealth,
  fetchOAuthConfig,
  fetchStatus,
  fetchUsers,
  killEditorSession,
  removeAllowedUser,
  setUserAdmin,
  updateAdminSettings,
  updateOAuthConfig,
} from './api'

type ConfirmAction = {
  title: string
  message: string
  confirmLabel: string
  danger?: boolean
  onConfirm: () => Promise<void>
}

function ConfirmDialog({ action, onClose }: { action: ConfirmAction; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    dialogRef.current?.showModal()
  }, [])

  async function handleConfirm() {
    setBusy(true)
    try {
      await action.onConfirm()
      onClose()
    } catch {
      setBusy(false)
    }
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      style={{
        border: '1px solid #E4EBF3',
        borderRadius: 8,
        padding: 24,
        maxWidth: 400,
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        margin: 0,
      }}
    >
      <h3 style={{ margin: '0 0 8px' }}>{action.title}</h3>
      <p style={{ margin: '0 0 20px', color: '#555' }}>{action.message}</p>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button className={action.danger ? 'danger' : 'primary'} onClick={handleConfirm} disabled={busy}>
          {busy ? '...' : action.confirmLabel}
        </button>
      </div>
    </dialog>
  )
}

export function AdminPage({ username }: { username: string }) {
  const [sessions, setSessions] = useState<Record<string, EditorSessionStatus>>({})
  const [registrationMode, setRegistrationMode] = useState<string>('open')
  const [savedMode, setSavedMode] = useState<string>('open')
  const [allowedUsers, setAllowedUsers] = useState<string[]>([])
  const [users, setUsers] = useState<AdminUser[]>([])
  const [oauthConfig, setOauthConfig] = useState<OAuthConfig>({ clientId: '', callbackUrl: '' })
  const [oauthEditing, setOauthEditing] = useState(false)
  const [oauthForm, setOauthForm] = useState({ clientId: '', clientSecret: '', callbackUrl: '' })
  const [oauthSaving, setOauthSaving] = useState(false)
  const [expandedUserId, setExpandedUserId] = useState<number | null>(null)
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null)
  const [newUser, setNewUser] = useState('')
  const [health, setHealth] = useState<HealthInfo | null>(null)
  const [workspacesSize, setWorkspacesSize] = useState<string | null>(null)
  const [duLoading, setDuLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const newUserRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    Promise.all([
      fetchStatus(),
      fetchAdminSettings(),
      fetchAllowedUsers(),
      fetchUsers(),
      fetchOAuthConfig(),
      fetchHealth(),
    ])
      .then(([sessions, settings, allowedUsers, users, oauth, health]) => {
        setSessions(sessions)
        setRegistrationMode(settings.registrationMode)
        setSavedMode(settings.registrationMode)
        setAllowedUsers(allowedUsers)
        setUsers(users)
        setOauthConfig(oauth)
        setHealth(health)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const interval = setInterval(() => {
      fetchHealth()
        .then(setHealth)
        .catch(() => {})
    }, 30_000)
    return () => clearInterval(interval)
  }, [])

  async function handleSaveMode() {
    setSaving(true)
    setError(null)
    try {
      await updateAdminSettings({ registrationMode })
      setSavedMode(registrationMode)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleAddUser() {
    const trimmed = newUser.trim().toLowerCase()
    if (!trimmed) return
    setError(null)
    try {
      await addAllowedUser(trimmed)
      setAllowedUsers(prev => (prev.includes(trimmed) ? prev : [...prev, trimmed].sort()))
      setNewUser('')
      newUserRef.current?.focus()
    } catch (e: any) {
      setError(e.message)
    }
  }

  async function handleRemoveUser(u: string) {
    setError(null)
    try {
      await removeAllowedUser(u)
      setAllowedUsers(prev => prev.filter(x => x !== u))
    } catch (e: any) {
      setError(e.message)
    }
  }

  async function handleKillSession(key: string) {
    const [viewer, projectId] = key.split('/')
    setError(null)
    try {
      await killEditorSession(viewer, projectId)
      setSessions(prev => {
        const next = { ...prev }
        delete next[key]
        return next
      })
    } catch (e: any) {
      setError(e.message)
    }
  }

  function confirmToggleAdmin(u: AdminUser) {
    const newValue = !u.is_admin
    setConfirmAction({
      title: newValue ? 'Promote to admin' : 'Remove admin',
      message: newValue
        ? `Make ${u.username} an administrator? They will be able to manage all users and settings.`
        : `Remove admin privileges from ${u.username}?`,
      confirmLabel: newValue ? 'Make admin' : 'Remove admin',
      async onConfirm() {
        await setUserAdmin(u.id, newValue)
        setUsers(prev => prev.map(x => (x.id === u.id ? { ...x, is_admin: newValue } : x)))
      },
    })
  }

  function confirmDeleteUser(u: AdminUser) {
    setConfirmAction({
      title: 'Delete user',
      message: `Permanently delete ${u.username} and all their projects? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
      async onConfirm() {
        await deleteUser(u.id)
        setUsers(prev => prev.filter(x => x.id !== u.id))
        setExpandedUserId(null)
      },
    })
  }

  function handleOauthEdit() {
    setOauthForm({
      clientId: oauthConfig.clientId,
      clientSecret: '',
      callbackUrl: oauthConfig.callbackUrl,
    })
    setOauthEditing(true)
  }

  async function handleOauthSave() {
    setOauthSaving(true)
    setError(null)
    try {
      await updateOAuthConfig({
        clientId: oauthForm.clientId,
        clientSecret: oauthForm.clientSecret || undefined,
        callbackUrl: oauthForm.callbackUrl,
      })
      setOauthConfig({ clientId: oauthForm.clientId, callbackUrl: oauthForm.callbackUrl })
      setOauthEditing(false)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setOauthSaving(false)
    }
  }

  if (loading)
    return (
      <main className="admin-page">
        <p>Loading...</p>
      </main>
    )

  const alive = Object.entries(sessions).filter(([, s]) => s.alive)
  const modeChanged = registrationMode !== savedMode

  function formatUptime(seconds: number): string {
    const d = Math.floor(seconds / 86400)
    const h = Math.floor((seconds % 86400) / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const parts: string[] = []
    if (d > 0) parts.push(`${d}d`)
    if (h > 0) parts.push(`${h}h`)
    parts.push(`${m}m`)
    return parts.join(' ')
  }

  function formatBytes(bytes: number): string {
    if (bytes >= 1024 * 1024 * 1024) return (bytes / 1024 / 1024 / 1024).toFixed(1) + ' GB'
    return (bytes / 1024 / 1024).toFixed(0) + ' MB'
  }

  return (
    <main className="admin-page">
      <h1>Admin</h1>

      {error && <div style={{ color: '#dc2626', marginBottom: 16 }}>{error}</div>}

      <section>
        <h2>Active editor sessions</h2>
        {alive.length === 0 ? (
          <p className="empty">No active editor sessions.</p>
        ) : (
          <ul className="project-list">
            {alive.map(([key, s]) => {
              const [user] = key.split('/')
              return (
                <li key={key}>
                  <div className="info">
                    <a href={`/${user}/`}>{user}</a>
                    <span style={{ color: '#90a4ae', margin: '0 0.25rem' }}>/</span>
                    <span style={{ fontSize: '0.85rem', color: '#666' }}>{s.projectId.slice(0, 8)}</span>
                  </div>
                  <div className="actions">
                    <span style={{ fontSize: '0.8rem', color: '#90a4ae' }}>port {s.port}</span>
                    <button className="delete" onClick={() => handleKillSession(key)}>
                      Kill
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section>
        <h2>OAuth Configuration</h2>
        {oauthEditing ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label>
              Client ID
              <input
                type="text"
                value={oauthForm.clientId}
                onChange={e => setOauthForm({ ...oauthForm, clientId: e.target.value })}
                style={{ width: '100%', marginTop: 4 }}
              />
            </label>
            <label>
              Client Secret
              <input
                type="password"
                value={oauthForm.clientSecret}
                onChange={e => setOauthForm({ ...oauthForm, clientSecret: e.target.value })}
                placeholder="Leave empty to keep current"
                style={{ width: '100%', marginTop: 4 }}
              />
            </label>
            <label>
              Callback URL
              <input
                type="text"
                value={oauthForm.callbackUrl}
                onChange={e => setOauthForm({ ...oauthForm, callbackUrl: e.target.value })}
                style={{ width: '100%', marginTop: 4 }}
              />
            </label>
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button onClick={handleOauthSave} disabled={oauthSaving}>
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
            <p style={{ fontSize: '0.9rem', margin: '4px 0' }}>
              <strong>Callback URL:</strong> {oauthConfig.callbackUrl || <em>not configured</em>}
            </p>
            <button onClick={handleOauthEdit} style={{ marginTop: 8 }}>
              Edit
            </button>
          </div>
        )}
      </section>

      <section>
        <h2>Access control</h2>
        <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input
              type="radio"
              name="regMode"
              value="open"
              checked={registrationMode === 'open'}
              onChange={() => setRegistrationMode('open')}
            />
            Open registration
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input
              type="radio"
              name="regMode"
              value="restricted"
              checked={registrationMode === 'restricted'}
              onChange={() => setRegistrationMode('restricted')}
            />
            Restricted (allowlist only)
          </label>
        </div>
        {modeChanged && (
          <button onClick={handleSaveMode} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        )}
      </section>

      <section>
        <h2>Allowed users</h2>
        <p style={{ fontSize: '0.9rem', color: '#666', marginBottom: 12 }}>
          GitHub usernames allowed to register when mode is "restricted".
        </p>
        {allowedUsers.length === 0 ? (
          <p className="empty">No users in the allowlist.</p>
        ) : (
          <ul className="project-list">
            {allowedUsers.map(u => (
              <li key={u}>
                <div className="info">{u}</div>
                <div className="actions">
                  <button className="delete" onClick={() => handleRemoveUser(u)}>
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
            type="text"
            value={newUser}
            onChange={e => setNewUser(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleAddUser()
            }}
            placeholder="GitHub username"
            style={{ flex: 1 }}
          />
          <button onClick={handleAddUser}>Add</button>
        </div>
      </section>

      <section>
        <h2>Registered users</h2>
        {users.length === 0 ? (
          <p className="empty">No users.</p>
        ) : (
          <ul className="project-list">
            {users.map(u => {
              const isExpanded = expandedUserId === u.id
              const isSelf = u.username === username
              return (
                <li key={u.id} style={{ display: 'block' }}>
                  <div
                    style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}
                    onClick={() => setExpandedUserId(isExpanded ? null : u.id)}
                  >
                    <span style={{ width: 16, fontSize: '0.7rem', color: '#90a4ae' }}>
                      {isExpanded ? '\u25BC' : '\u25B6'}
                    </span>
                    <div className="info" style={{ flex: 1 }}>
                      <a href={`/${u.username}/`} onClick={e => e.stopPropagation()}>
                        {u.username}
                      </a>
                      {isSelf && <span style={{ fontSize: '0.75rem', color: '#90a4ae', marginLeft: 8 }}>(you)</span>}
                    </div>
                    <span style={{ fontSize: '0.8rem', color: '#90a4ae' }}>{u.is_admin ? 'admin' : 'user'}</span>
                  </div>
                  {isExpanded && (
                    <div style={{ padding: '12px 0 4px 16px', display: 'flex', gap: 8 }}>
                      <button disabled={isSelf} onClick={() => confirmToggleAdmin(u)}>
                        {u.is_admin ? 'Make normal user' : 'Make admin'}
                      </button>
                      <button className="delete" disabled={isSelf} onClick={() => confirmDeleteUser(u)}>
                        Delete user
                      </button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {health && (
        <section>
          <h2>System health</h2>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <tbody>
              <tr>
                <td style={{ padding: '4px 12px 4px 0', color: '#666' }}>Host Disk usage</td>
                <td style={{ padding: '4px 0' }}>
                  {health.dataVolumeDisk.used} / {health.dataVolumeDisk.total} ({health.dataVolumeDisk.percent})
                </td>
              </tr>
              <tr>
                <td style={{ padding: '4px 12px 4px 0', color: '#666' }}>Host Memory</td>
                <td style={{ padding: '4px 0' }}>
                  {formatBytes(health.memory.total - health.memory.available)} / {formatBytes(health.memory.total)} used
                </td>
              </tr>
              {health.memory.swapTotal > 0 && (
                <tr>
                  <td style={{ padding: '4px 12px 4px 0', color: '#666' }}>Swap</td>
                  <td style={{ padding: '4px 0' }}>
                    {formatBytes(health.memory.swapTotal - health.memory.swapFree)} /{' '}
                    {formatBytes(health.memory.swapTotal)} used
                  </td>
                </tr>
              )}
              <tr>
                <td style={{ padding: '4px 12px 4px 0', color: '#666' }}>Workspaces size</td>
                <td style={{ padding: '4px 0' }}>
                  {workspacesSize ?? (
                    <button
                      disabled={duLoading}
                      onClick={async () => {
                        setDuLoading(true)
                        try {
                          const { workspaces } = await fetchDiskUsage()
                          setWorkspacesSize(workspaces)
                        } catch {
                          setWorkspacesSize('error')
                        }
                        setDuLoading(false)
                      }}
                    >
                      {duLoading ? 'Computing...' : 'Compute'}
                    </button>
                  )}
                </td>
              </tr>
              <tr>
                <td style={{ padding: '4px 12px 4px 0', color: '#666' }}>Load average</td>
                <td style={{ padding: '4px 0' }}>{health.loadAvg.map(n => n.toFixed(2)).join(', ')}</td>
              </tr>
              <tr>
                <td style={{ padding: '4px 12px 4px 0', color: '#666' }}>Workbench uptime</td>
                <td style={{ padding: '4px 0' }}>{formatUptime(health.uptime)}</td>
              </tr>
            </tbody>
          </table>
        </section>
      )}

      {confirmAction && <ConfirmDialog action={confirmAction} onClose={() => setConfirmAction(null)} />}
    </main>
  )
}
