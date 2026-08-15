'use client'

import { useState } from 'react'
import z from 'zod'

import authClient from '@/lib/client/auth'

export default function Unauthorized() {
  const [oneTimePassword, setOneTimePassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')
  const newPasswordsMatch =
    newPassword.trim() === '' || confirmNewPassword.trim() === '' || newPassword === confirmNewPassword

  const [status, setStatus] = useState<null | { type: 'incorrect-password' } | { type: 'api-error'; message: string }>(
    null,
  )

  async function login() {
    try {
      await authClient.signIn.email({
        email: 'admin@admin.localhost',
        password: oneTimePassword,
      })

      // This try-catch won't perfectly prevent a bypass of the change-password
      // requirement, but it's about the best we can do client-side
      try {
        await authClient.changePassword({ currentPassword: oneTimePassword, newPassword })
      } catch (e) {
        await authClient.signOut()
        throw e
      }

      // useRouter().refresh() won't clear the unauthorized() status
      window.location.reload()
    } catch (e) {
      if (z.object({ error: z.object({ code: z.literal('INVALID_EMAIL_OR_PASSWORD') }) }).safeParse(e).success) {
        setStatus({ type: 'incorrect-password' })
      } else {
        const betterAuthMessage = z.object({ error: z.object({ message: z.string() }) }).safeParse(e)
        setStatus({
          type: 'api-error',
          message: betterAuthMessage.success
            ? betterAuthMessage.data.error.message
            : e instanceof Error
              ? e.message
              : String(e),
        })
      }
    }
  }

  return (
    <div>
      <h1>Create Administrator Account</h1>
      <div style={{ display: 'grid', gap: 8 }}>
        <h3>Welcome to Lean Workbench!</h3>
        <p>
          To create an administrator account and begin setup, enter the initial administrator password printed by the
          installer and then set a new one.
        </p>
        <form action={login} style={{ display: 'grid', gap: 4 }}>
          <label htmlFor='one-time-password'>Initial password</label>
          <input
            id='one-time-password'
            autoComplete='off'
            type='password'
            value={oneTimePassword}
            onChange={e => {
              setOneTimePassword(e.target.value)
              setStatus(null)
            }}
            required
            style={{ width: '100%', marginTop: 4 }}
          />
          {status?.type === 'incorrect-password' && <p style={{ color: '#F00' }}>Incorrect password</p>}
          <label htmlFor='new-password'>New password</label>
          <input
            id='new-password'
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
          <button
            type='submit'
            disabled={
              (status && status.type === 'incorrect-password') ||
              oneTimePassword.trim() === '' ||
              newPassword.trim() === '' ||
              !newPasswordsMatch
            }
          >
            Log in
          </button>
          {status?.type === 'api-error' && <p style={{ color: '#F00' }}>{status.message}</p>}
        </form>
      </div>
    </div>
  )
}
