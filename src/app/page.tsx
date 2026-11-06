import { Suspense } from 'react'

import { ConfigCtxProvider } from '@/app/components/ConfigCtxProvider'

import { LoginErrorBox } from './LoginErrorBox'
import { SignInOptions } from './SignInOptions'

export default function Root() {
  return (
    <>
      <h1>Lean Workbench</h1>
      <p>Multi-user sandboxed VS Code server.</p>
      <Suspense>
        <ConfigCtxProvider>
          <LoginErrorBox />
          <h2>Sign in options</h2>
          <SignInOptions />
        </ConfigCtxProvider>
      </Suspense>
    </>
  )
}
