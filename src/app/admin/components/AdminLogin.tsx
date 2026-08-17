'use client'

import { adminEmail } from '@leanprover/workbench-shared'
import { useState } from 'react'
import z from 'zod'

import authClient from '@/lib/client/auth'

export default function AdminLogin() {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<null | string>(null)

  async function login() {
    try {
      await authClient.signIn.email({ email: adminEmail, password })
      window.location.reload()
    } catch (e) {
      if (z.object({ error: z.object({ code: z.literal('INVALID_EMAIL_OR_PASSWORD') }) }).safeParse(e).success) {
        setError('Incorrect password')
      } else {
        const betterAuthMessage = z.object({ error: z.object({ message: z.string() }) }).safeParse(e)
        setError(
          betterAuthMessage.success ? betterAuthMessage.data.error.message : e instanceof Error ? e.message : String(e),
        )
      }
    }
  }

  return (
    <div>
      <h1>Workbench admin login</h1>
      <div style={{ display: 'grid', gap: 8 }}>
        <form action={login} style={{ display: 'grid', gap: 4 }}>
          <label htmlFor='password'>
            Password for admin user
            <input
              id='password'
              type='password'
              onChange={e => {
                setPassword(e.target.value)
                setError(null)
              }}
              required
              style={{ width: '100%', marginTop: 4 }}
            ></input>
          </label>
          <button type='submit' disabled={password.trim() === ''}>
            Log in
          </button>
          {error && <p style={{ color: '#F00' }}>{error}</p>}
        </form>
      </div>
    </div>
  )
}
