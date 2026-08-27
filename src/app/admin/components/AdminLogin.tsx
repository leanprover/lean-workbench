'use client'

import { adminEmail, MIN_ADMIN_PASSWORD_LENGTH } from '@leanprover/workbench-shared'
import { useActionState } from 'react'
import z from 'zod'

import auth from '@/lib/client/auth'

async function loginAction(_: string | null, formData: FormData) {
  const password = String(formData.get('password') ?? '')
  try {
    await auth.signIn.email({ email: adminEmail, password })
  } catch (e) {
    if (z.object({ error: z.object({ code: z.literal('INVALID_EMAIL_OR_PASSWORD') }) }).safeParse(e).success) {
      return 'Incorrect password'
    }
    throw e
  }

  window.location.reload()
  return null
}

export default function AdminLogin() {
  const [error, action, isPending] = useActionState(loginAction, null)

  return (
    <div>
      <h1>Workbench admin login</h1>
      <div style={{ display: 'grid', gap: 8 }}>
        <form action={action} style={{ display: 'grid', gap: 4 }}>
          <label htmlFor='password'>
            Password for admin user
            <input
              id='password'
              name='password'
              type='password'
              required
              style={{ width: '100%', marginTop: 4 }}
              minLength={MIN_ADMIN_PASSWORD_LENGTH}
            />
          </label>
          <button type='submit' disabled={isPending}>
            Log in
          </button>
          {error && <p style={{ color: '#F00' }}>{error}</p>}
        </form>
      </div>
    </div>
  )
}
