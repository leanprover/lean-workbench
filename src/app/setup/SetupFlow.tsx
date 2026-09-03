'use client'

import { redirect, useRouter } from 'next/navigation'
import { useState } from 'react'

import TrackedCommandForm from '@/app/components/TrackedCommandForm'
import { useConfigCtx } from '@/lib/contexts'

import { doSeed } from './actions'

interface SetupFlowProps {
  baseUrl: string
}

export default function SetupFlow({ baseUrl }: SetupFlowProps) {
  const router = useRouter()
  const cfg = useConfigCtx()
  const [wasCompleteOnMount] = useState(cfg.isSetupComplete)
  if (wasCompleteOnMount) redirect('/')

  return (
    <TrackedCommandForm
      streamCommandKey='seed'
      initiallyWatchingTTY
      title='Start Setup'
      trackedCommandAction={doSeed}
      style={{ margin: '20px 0' }}
      successButton={{
        text: 'Continue to Lean Workbench',
        action: () => {
          router.refresh()
          router.push('/admin')
        },
      }}
    >
      <label>
        {' '}
        <input type='checkbox' name='installToolchain' defaultChecked /> Install latest stable toolchain?
      </label>
      <input type='hidden' name='baseUrl' value={baseUrl} />
    </TrackedCommandForm>
  )
}
