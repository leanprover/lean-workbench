'use client'

import { type Route } from 'next'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

import authClient from '@/lib/client/auth'
import { useServerAction, useThrowToBoundary } from '@/lib/client/util'
import { type Config, useConfigCtx } from '@/lib/contexts'
import { loginDevUser } from '@/lib/server/actions'

import ErrorBox from './components/ErrorBox'

/**
 * Interprets an (untrusted) `error` search parameter as OAuth callback information
 */
function errorParamToMsg(e: string, cfg: Config): string {
  if (e === 'unable_to_create_user') {
    let msg = 'Could not sign up.'
    if (cfg.registrationMode === 'restricted') {
      msg += ' Ask your administrator to allow you to register.'
    }
    return msg
  } else if (e === 'invalid_code') {
    return 'Invalid GitHub OAuth configuration. Ask your administrator to fix it.'
  } else {
    // An unrecognized search parameter should not be shown directly to the user (phishing risk)
    return 'Unexpected sign-in failure. Please try again; contact your administrator if this error continues.'
  }
}

export default function Root() {
  const cfg = useConfigCtx()
  const session = authClient.useSession()
  const error = useSearchParams().get('error')
  const { throwToBoundary } = useThrowToBoundary()
  const [_, devLoginAction] = useServerAction(loginDevUser, () => session.refetch())

  return (
    <>
      {error && <ErrorBox>Error logging in: {errorParamToMsg(error, cfg)}</ErrorBox>}
      <h1>Lean Workbench</h1>
      <p>Multi-user sandboxed VS Code server.</p>
      {session.data && (
        <div className='welcome'>
          <h2>Welcome, {session.data.user.displayName ?? session.data.user.name}</h2>
          <p>
            <Link href={`/${session.data.user.name}/` as Route}>Go to your profile</Link>
          </p>
        </div>
      )}
      {!session.data && !session.isPending && (
        <>
          <h2>Sign in options</h2>
          <button
            className='login-link'
            disabled={!cfg.hasGithubAuth}
            title={!cfg.hasGithubAuth ? 'Ask your administrator to set up GitHub authentication.' : undefined}
            onClick={() => {
              authClient.signIn.social({ provider: 'github' }).catch(throwToBoundary)
            }}
          >
            GitHub
          </button>
          {cfg.isDevMode && (
            <form action={devLoginAction} className='num-button'>
              <div style={{ display: 'grid', gridTemplateColumns: 'auto min-content' }}>
                <button className='login-link' type='submit'>
                  [DEV]
                </button>
                <input type='number' name='n' defaultValue={1} min={1} />
              </div>
            </form>
          )}
        </>
      )}
    </>
  )
}
