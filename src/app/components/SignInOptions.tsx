'use client'

import { faGithub } from '@fortawesome/free-brands-svg-icons'
import { faGears } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { adminEmail, MIN_ADMIN_PASSWORD_LENGTH } from '@leanprover/workbench-shared'
import { useSearchParams } from 'next/navigation'
import { useActionState } from 'react'
import { Button } from 'react-aria-components'
import z from 'zod'

import { ErrorBox } from '@/app/components/ErrorBox'
import { authClient, githubSignin } from '@/lib/client/auth'
import { useServerAction, useThrowToBoundary } from '@/lib/client/util'
import { useConfigCtx } from '@/lib/contexts'
import { loginDevUser } from '@/lib/server/actions'

async function adminLogin(_: string | null, formData: FormData) {
  const password = String(formData.get('password') ?? '')
  try {
    await authClient.signIn.email({ email: adminEmail, password })
  } catch (e) {
    if (z.object({ error: z.object({ code: z.literal('INVALID_EMAIL_OR_PASSWORD') }) }).safeParse(e).success) {
      return 'Incorrect password'
    }
    throw e
  }

  window.location.reload()
  return null
}

export function SignInOptions() {
  const cfg = useConfigCtx()
  const { throwToBoundary } = useThrowToBoundary()
  const [devLoginError, devLoginAction, devLoginPending] = useServerAction(loginDevUser, () => window.location.reload())
  const [adminLoginError, adminLoginAction, adminLoginPending] = useActionState(adminLogin, null)
  const searchParams = useSearchParams()

  const isLoginPossible = cfg.hasGitHubAuth || cfg.isDevMode
  const isPending = devLoginPending || adminLoginPending
  const error = devLoginError ?? adminLoginError

  return (
    <>
      {!isLoginPossible && <ErrorBox>Ask your administrator to set up an authentication method.</ErrorBox>}
      {cfg.hasGitHubAuth && (
        <Button className='login-link login-item' onClick={() => githubSignin().catch(throwToBoundary)}>
          <FontAwesomeIcon icon={faGithub} /> Sign in via GitHub
        </Button>
      )}
      {cfg.isDevMode && (
        <form action={devLoginAction} className='num-button login-item'>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto min-content' }}>
            <Button className='login-link' type='submit'>
              <FontAwesomeIcon icon={faGears} /> Dev Login
            </Button>
            <input type='number' name='n' defaultValue={1} min={1} max={10000} required />
          </div>
        </form>
      )}
      {(searchParams.get('admin') === 'true' || !isLoginPossible) && (
        <form action={adminLoginAction}>
          <p style={{ textAlign: 'left' }}>Password for built-in admin user:</p>
          <div style={{ display: 'flex' }}>
            <input
              id='password'
              type='password'
              name='password'
              required
              disabled={isPending}
              minLength={MIN_ADMIN_PASSWORD_LENGTH}
              style={{ flexGrow: 1 }}
            />
            <Button isPending={isPending} type='submit'>
              Login
            </Button>
          </div>
        </form>
      )}
      {error && <div style={{ color: '#dc2626', fontSize: 13 }}>{error}</div>}
    </>
  )
}
