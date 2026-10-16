'use client'

import { useRouter } from 'next/navigation'
import { startTransition } from 'react'

import { deleteUser, toggleAdmin } from '@/app/admin/actions'
import { useServerAction } from '@/lib/client/util'

type User = { id: string; name: string; isAdmin: boolean }

export function UserRow({ user, isSelf }: { user: User; isSelf: boolean }) {
  const router = useRouter()

  const [toggleError, toggleAction, togglePending] = useServerAction(toggleAdmin, () => router.refresh())
  const [deleteError, deleteAction, deletePending] = useServerAction(deleteUser, () => router.refresh())

  const pending = togglePending || deletePending
  const error = toggleError ?? deleteError

  function handleToggleAdmin() {
    const msg = user.isAdmin
      ? `Remove admin privileges from ${user.name}?`
      : `Make ${user.name} an administrator? They will be able to manage all users and settings.`
    if (!confirm(msg)) return
    startTransition(() => toggleAction({ userId: user.id, isAdmin: !user.isAdmin }))
  }

  function handleDelete() {
    if (!confirm(`Permanently delete ${user.name} and all their projects? This cannot be undone.`)) return
    startTransition(() => deleteAction({ userId: user.id }))
  }

  return (
    <li>
      <div>
        <div>
          <span>{user.name}</span>
          {isSelf && (
            <span style={{ fontSize: '0.75rem', color: '#90a4ae', marginLeft: 8, marginRight: 8 }}>(you)</span>
          )}
          {user.isAdmin && <span className='admin-badge'>admin</span>}
        </div>
      </div>

      <div className='secondary'>ID {user.id}</div>
      <div className='actions'>
        <button disabled={isSelf || pending} onClick={handleToggleAdmin}>
          {user.isAdmin ? 'Remove admin' : 'Make admin'}
        </button>
        <button className='delete' disabled={isSelf || pending} onClick={handleDelete}>
          Delete user
        </button>
      </div>
      {error && <div style={{ color: '#dc2626', fontSize: 13 }}>{error}</div>}
    </li>
  )
}
