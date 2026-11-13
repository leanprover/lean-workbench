'use client'

import { faGithub } from '@fortawesome/free-brands-svg-icons'
import { faGears } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { Button } from 'react-aria-components'

import { ErrorBox } from '@/app/components/ErrorBox'
import { githubSignin } from '@/lib/client/auth'
import { useServerAction, useThrowToBoundary } from '@/lib/client/util'
import { useConfigCtx } from '@/lib/contexts'
import { loginDevUser } from '@/lib/server/actions'

export function SignInOptions() {
  const cfg = useConfigCtx()
  const { throwToBoundary } = useThrowToBoundary()
  const [_, devLoginAction] = useServerAction(loginDevUser, () => window.location.reload())

  const isLoginPossible = cfg.hasGitHubAuth || cfg.isDevMode

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
    </>
  )
}
