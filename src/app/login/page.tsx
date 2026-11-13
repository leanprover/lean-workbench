import { Suspense } from 'react'

import { BaseUrl } from '@/app/components/BaseUrl'
import { ConfigCtxProvider } from '@/app/components/ConfigCtxProvider'
import { SignInOptions } from '@/app/components/SignInOptions'

export default function Login() {
  return (
    <main className='login'>
      <h1>Sign in to Lean Workbench</h1>
      <h2>
        <BaseUrl />
      </h2>
      <Suspense>
        <ConfigCtxProvider>
          <SignInOptions />
        </ConfigCtxProvider>
      </Suspense>
    </main>
  )
}
