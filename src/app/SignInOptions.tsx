'use client'

import { githubSignin, useReloadSession } from '@/lib/client/auth'
import { useServerAction, useThrowToBoundary } from '@/lib/client/util'
import { useConfigCtx } from '@/lib/contexts'
import { loginDevUser } from '@/lib/server/actions'

export function SignInOptions() {
  const cfg = useConfigCtx()
  const { throwToBoundary } = useThrowToBoundary()
  const reloadSession = useReloadSession()
  const [_, devLoginAction] = useServerAction(loginDevUser, () => reloadSession())

  return (
    <>
      <button
        className='login-link'
        disabled={!cfg.hasGitHubAuth}
        title={!cfg.hasGitHubAuth ? 'Ask your administrator to set up GitHub authentication.' : undefined}
        onClick={() => githubSignin().catch(throwToBoundary)}
      >
        GitHub
      </button>
      {cfg.isDevMode && (
        <form action={devLoginAction} className='num-button'>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto min-content' }}>
            <button className='login-link' type='submit'>
              [DEV]
            </button>
            <input type='number' name='n' defaultValue={1} min={1} max={10000} required />
          </div>
        </form>
      )}
    </>
  )
}
