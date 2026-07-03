'use client'

import { useRouter } from 'next/navigation'
import { startTransition, useState } from 'react'

import { deleteUser, toggleAdmin } from '@/app/admin/actions'
import { useServerAction } from '@/lib/client/util'

type User = { id: string; name: string; isAdmin: boolean }

export function UserRow({ user, isSelf }: { user: User; isSelf: boolean }) {
  const router = useRouter()
  const [expanded, setExpanded] = useState(false)

  const [toggleError, toggleAction, togglePending] = useServerAction(
    () => toggleAdmin({ userId: user.id, isAdmin: !user.isAdmin }),
    () => router.refresh(),
  )
  const [deleteError, deleteAction, deletePending] = useServerAction(
    () => deleteUser({ userId: user.id }),
    () => router.refresh(),
  )

  const pending = togglePending || deletePending
  const error = toggleError ?? deleteError

  function handleToggleAdmin() {
    const msg = user.isAdmin
      ? `Remove admin privileges from ${user.name}?`
      : `Make ${user.name} an administrator? They will be able to manage all users and settings.`
    if (!confirm(msg)) return
    startTransition(toggleAction)
  }

  function handleDelete() {
    if (!confirm(`Permanently delete ${user.name} and all their projects? This cannot be undone.`)) return
    startTransition(deleteAction)
  }

  return (
    <li style={{ display: 'block' }}>
      <div style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }} onClick={() => setExpanded(x => !x)}>
        <span style={{ width: 16, fontSize: '0.7rem', color: '#90a4ae' }}>{expanded ? '\u25BC' : '\u25B6'}</span>
        <div className='info' style={{ flex: 1 }}>
          <span>{user.name}</span>
          {user.isAdmin && <span className='admin-badge'>admin</span>}
          {isSelf && <span style={{ fontSize: '0.75rem', color: '#90a4ae', marginLeft: 8 }}>(you)</span>}
        </div>
      </div>
      {expanded && (
        <div style={{ padding: '12px 0 4px 16px', display: 'flex', gap: 8 }}>
          <button disabled={isSelf || pending} onClick={handleToggleAdmin}>
            {user.isAdmin ? 'Make normal user' : 'Make admin'}
          </button>
          <button className='delete' disabled={isSelf || pending} onClick={handleDelete}>
            Delete user
          </button>
        </div>
      )}
      {error && <div style={{ color: '#dc2626', fontSize: 13 }}>{error}</div>}
    </li>
  )
}
