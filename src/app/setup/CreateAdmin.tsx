'use client'

import { useState } from 'react'

import { useServerAction } from '@/lib/client/util'

import { initialLogin } from './actions'

export default function CreateAdmin() {
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')
  const newPasswordsMatch =
    newPassword.trim() === '' || confirmNewPassword.trim() === '' || newPassword === confirmNewPassword

  const [error, action, pending] = useServerAction(initialLogin, async () => window.location.reload())

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
          <label htmlFor='one-time-password'>Initial password</label>
          <input
            id='initAdminPassword'
            name='initAdminPassword'
            autoComplete='off'
            type='password'
            required
            style={{ width: '100%', marginTop: 4 }}
          />
          <label htmlFor='new-password'>New password</label>
          <input
            id='newAdminPassword'
            name='newAdminPassword'
            autoComplete='new-password'
            type='password'
            minLength={8}
            value={newPassword}
            onChange={e => {
              setNewPassword(e.target.value)
            }}
            required
            style={{ width: '100%', marginTop: 4 }}
          ></input>
          <label htmlFor='confirm-new-password'>Confirm new password</label>
          <input
            id='confirm-new-password'
            autoComplete='new-password'
            type='password'
            minLength={8}
            value={confirmNewPassword}
            onChange={e => {
              setConfirmNewPassword(e.target.value)
            }}
            required
            style={{ width: '100%', marginTop: 4 }}
          ></input>
          {!newPasswordsMatch && <p style={{ color: '#F00' }}>New passwords don&apos;t match</p>}
          <button type='submit' disabled={pending || !!error || newPassword.trim() === '' || !newPasswordsMatch}>
            Log in
          </button>
          {error && <p style={{ color: '#F00' }}>{error}</p>}
        </form>
      </div>
    </div>
  )
}
