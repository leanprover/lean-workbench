import { io } from 'next/cache'
import { Suspense } from 'react'

import { ConfigCtxProvider } from '@/app/components/ConfigCtxProvider'
import { LoginErrorBox } from '@/app/components/LoginErrorBox'
import { SignInOptions } from '@/app/components/SignInOptions'
import { getConfig } from '@/lib/server/config'

/**
 * Gives the baseUrl in the website configuration.
 * Awaits io() so that it won't be rendered at build time.
 */
async function AsyncBaseUrl() {
  await io()
  const cfg = getConfig()
  return cfg.baseUrl
}

export function LoginLayout() {
  return (
    <main className='login'>
      <h1>Sign in to Lean Workbench</h1>
      <h2>
        <Suspense fallback={<>&nbsp;</>}>
          <AsyncBaseUrl />
        </Suspense>
      </h2>
      <Suspense>
        <ConfigCtxProvider>
          <LoginErrorBox />
          <SignInOptions />
        </ConfigCtxProvider>
      </Suspense>
    </main>
  )
}
