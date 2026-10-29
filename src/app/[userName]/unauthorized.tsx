'use client'

import { githubSignin } from '@/lib/client/auth'
import { useThrowToBoundary } from '@/lib/client/util'
import { useConfigCtx } from '@/lib/contexts'

export default function UnauthorizedProjects() {
  const cfg = useConfigCtx()
  const { throwToBoundary } = useThrowToBoundary()

  return (
    <div>
      <h1>Sign In Required</h1>
      <p>You must be signed in to view profiles or projects.</p>
      {cfg.hasGithubAuth && (
        <button style={{ marginTop: 10 }} className='login-link' onClick={() => githubSignin().catch(throwToBoundary)}>
          Sign in via GitHub
        </button>
      )}
    </div>
  )
}
