'use client'

import authClient from '@/lib/auth-client'
import { ConfigCtx } from '@/lib/contexts'
import { Route } from 'next'
import Link from 'next/link'
import { useContext } from 'react'

export default function Root() {
  const cfg = useContext(ConfigCtx)
  const session = authClient.useSession()
  console.log(cfg)

  return (
    <>
      <h1>Lean Workbench</h1>
      <p>Multi-user sandboxed VS Code server.</p>
      {session.data && (
        <div className='welcome'>
          <h2>Welcome, {session.data.user.name}</h2>
          {/* TODO username != user.name */}
          <p>
            <Link href={`/${session.data.user.id}/` as Route}>Go to your profile</Link>
          </p>
        </div>
      )}
      {!session.data && (
        <>
          <h2>Sign in options</h2>
          {cfg.hasGithubAuth && (
            <a
              className='login-link'
              onClick={() => {
                authClient.signIn.social({
                  provider: 'github',
                })
              }}
            >
              GitHub
            </a>
          )}
          {cfg.isDevMode && (
            <>
              <a className='login-link' href='/dev-login'>
                Dev
              </a>
              <a className='login-link' href='/dev-admin-login'>
                Dev admin
              </a>
            </>
          )}
        </>
      )}
    </>
  )
}
