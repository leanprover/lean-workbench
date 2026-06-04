'use client'

import authClient from '@/lib/client/auth'
import { type Config, ConfigCtx } from '@/lib/contexts'
import { Route } from 'next'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useContext } from 'react'
import Error from './components/Error'

type ErrorParam = 'unable_to_create_user' | string

function errorParamToMsg(e: ErrorParam, cfg: Config): string {
  if (e === 'unable_to_create_user') {
    let msg = 'Could not sign up.'
    if (cfg.registrationMode === 'restricted') {
      msg += ' Ask your administrator to allow you to register.'
    }
    return msg
  } else if (e === 'invalid_code') {
    return 'Invalid GitHub OAuth configuration. Ask your administrator to fix it.'
  } else {
    return e
  }
}

export default function Root() {
  const cfg = useContext(ConfigCtx)
  const session = authClient.useSession()
  const error = useSearchParams().get('error')

  return (
    <>
      {error && <Error>Error: {errorParamToMsg(error, cfg)}</Error>}
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
              authClient.signIn.social({
                provider: 'github',
              })
            }}
          >
            GitHub
          </button>
          {cfg.isDevMode && (
            <button
              className='login-link'
              onClick={async () => {
                const email = 'dev@dev.localhost'
                const name = 'dev'
                const password = 'dev'
                await authClient.signUp.email({ email, name, password })
                await authClient.signIn.email({ email, password })
              }}
            >
              [DEV]
            </button>
          )}
        </>
      )}
    </>
  )
}
