'use client'

import { adminEmail, MIN_ADMIN_PASSWORD_LENGTH } from '@leanprover/workbench-shared'
import { useActionState, useState } from 'react'

import auth from '@/lib/client/auth'

async function firstLoginAction(_: string | null, formData: FormData) {
  const currentPassword = String(formData.get('currentPassword') ?? '')
  const newPassword = String(formData.get('newPassword') ?? '')
  try {
    await auth.signIn.email({ email: adminEmail, password: currentPassword })
  } catch (e) {
    return 'Incorrect password'
  }

  try {
    // Technically a write-after-read race condition (currentPassword could have changed!). It's fine.
    await auth.changePassword({ currentPassword, newPassword, revokeOtherSessions: true })
  } catch (e) {
    await auth.signOut()
    return 'New password is not valid'
  }

  window.location.reload()
  return null
}

export default function SetupAdmin() {
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')
  const newPasswordsMatch =
    newPassword.trim() === '' || confirmNewPassword.trim() === '' || newPassword === confirmNewPassword
  const [error, action, isPending] = useActionState(firstLoginAction, null)

  return (
    <div>
      <h1>Create Administrator Account</h1>
      <div style={{ display: 'grid', gap: 8 }}>
        <h3>Welcome to Lean Workbench!</h3>
        <p>
          To create an administrator account and begin setup, enter the initial administrator password printed by the
          installer and then set a new one.
        </p>
        <form action={action} style={{ display: 'grid', gap: 4 }}>
          <label htmlFor='currentPassword'>Initial password</label>
          <input
            id='currentPassword'
            name='currentPassword'
            autoComplete='off'
            type='password'
            required
            style={{ width: '100%', marginTop: 4 }}
          />
          <label htmlFor='newAdminPassword'>New password</label>
          <input
            id='newPassword'
            name='newPassword'
            autoComplete='new-password'
            type='password'
            minLength={MIN_ADMIN_PASSWORD_LENGTH}
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            required
            style={{ width: '100%', marginTop: 4 }}
          />
          <label htmlFor='confirm-new-password'>Confirm new password</label>
          <input
            id='confirm-new-password'
            autoComplete='new-password'
            type='password'
            minLength={MIN_ADMIN_PASSWORD_LENGTH}
            value={confirmNewPassword}
            onChange={e => setConfirmNewPassword(e.target.value)}
            required
            style={{ width: '100%', marginTop: 4 }}
          />
          {!newPasswordsMatch && <p style={{ color: '#F00' }}>New passwords don&apos;t match</p>}
          <button
            type='submit'
            disabled={isPending || newPassword.trim() === '' || confirmNewPassword.trim() === '' || !newPasswordsMatch}
          >
            Log in
          </button>
          {error && <p style={{ color: '#F00' }}>{error}</p>}
        </form>
      </div>
    </div>
  )
}
