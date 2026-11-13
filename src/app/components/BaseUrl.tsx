import { io } from 'next/cache'
import { Suspense } from 'react'

import { getConfig } from '@/lib/server/config'

async function AsyncBaseUrl() {
  await io()
  const cfg = getConfig()
  return cfg.baseUrl
}

export function BaseUrl() {
  return (
    <Suspense fallback={<>&nbsp;</>}>
      <AsyncBaseUrl />
    </Suspense>
  )
}
