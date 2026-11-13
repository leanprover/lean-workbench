import { Suspense } from 'react'

import { ConfigCtxProvider } from '@/app/components/ConfigCtxProvider'
import { SignInOptions } from '@/app/components/SignInOptions'

import { BaseUrl } from './components/BaseUrl'

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
