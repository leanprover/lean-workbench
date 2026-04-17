'use client'

import { useState } from 'react'
import { deleteUser, toggleAdmin } from '../actions'
import { ConfirmDialog } from './ConfirmDialog'
import type { ConfirmAction, User } from './types'

export function UserManagement({
  users,
  currentUserId,
  onUsersChange,
}: {
  users: User[]
  currentUserId: string
  onUsersChange: (users: User[]) => void
}) {
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null)
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null)

  function confirmToggleAdmin(u: User) {
    const newValue = !u.isAdmin
    setConfirmAction({
      title: newValue ? 'Promote to admin' : 'Remove admin',
      message: newValue
        ? `Make ${u.name} an administrator? They will be able to manage all users and settings.`
        : `Remove admin privileges from ${u.name}?`,
      confirmLabel: newValue ? 'Make admin' : 'Remove admin',
      async onConfirm() {
        const result = await toggleAdmin(u.id, newValue)
        if ('error' in result) throw new Error(result.error)
        onUsersChange(users.map(x => (x.id === u.id ? { ...x, isAdmin: newValue } : x)))
      },
    })
  }

  function confirmDeleteUser(u: User) {
    setConfirmAction({
      title: 'Delete user',
      message: `Permanently delete ${u.name} and all their projects? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
      async onConfirm() {
        const result = await deleteUser(u.id)
        if ('error' in result) throw new Error(result.error)
        onUsersChange(users.filter(x => x.id !== u.id))
        setExpandedUserId(null)
      },
    })
  }

  return (
    <>
      <section>
        <h2>Registered users</h2>
        {users.length === 0 ? (
          <p className='empty'>No users.</p>
        ) : (
          <ul className='project-list'>
            {users.map(u => {
              const isExpanded = expandedUserId === u.id
              const isSelf = u.id === currentUserId
              return (
                <li key={u.id} style={{ display: 'block' }}>
                  <div
                    style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}
                    onClick={() => setExpandedUserId(isExpanded ? null : u.id)}
                  >
                    <span style={{ width: 16, fontSize: '0.7rem', color: '#90a4ae' }}>
                      {isExpanded ? '\u25BC' : '\u25B6'}
                    </span>
                    <div className='info' style={{ flex: 1 }}>
                      <span>{u.name}</span>
                      {u.isAdmin && <span className='admin-badge'>admin</span>}
                      {isSelf && <span style={{ fontSize: '0.75rem', color: '#90a4ae', marginLeft: 8 }}>(you)</span>}
                    </div>
                  </div>
                  {isExpanded && (
                    <div style={{ padding: '12px 0 4px 16px', display: 'flex', gap: 8 }}>
                      <button disabled={isSelf} onClick={() => confirmToggleAdmin(u)}>
                        {u.isAdmin ? 'Make normal user' : 'Make admin'}
                      </button>
                      <button className='delete' disabled={isSelf} onClick={() => confirmDeleteUser(u)}>
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

      {confirmAction && <ConfirmDialog action={confirmAction} onClose={() => setConfirmAction(null)} />}
    </>
  )
}
