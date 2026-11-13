import Image from 'next/image'
import { Suspense } from 'react'

import { AppLayout } from '@/app/components/AppLayout'
import { ConfigCtxProvider } from '@/app/components/ConfigCtxProvider'
import { SignInOptions } from '@/app/components/SignInOptions'

export default function Root() {
  return (
    <AppLayout title='Lean Workbench' mainClass='root'>
      <p>
        Edit, share, and collaborate on Lean projects,
        <br />
        no installation or download required.
      </p>
      <Suspense>
        <ConfigCtxProvider>
          <SignInOptions />
        </ConfigCtxProvider>
      </Suspense>
      <Image src='/static/screenshot.png' alt='Lean Workbench in editing mode' width={1056} height={575}></Image>
    </AppLayout>
  )
}
