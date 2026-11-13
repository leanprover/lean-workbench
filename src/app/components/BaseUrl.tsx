import { io } from 'next/cache'
import { Suspense } from 'react'

import { getConfig } from '@/lib/server/config'

async function AsyncBaseUrl() {
  await io()
  const cfg = getConfig()
  return cfg.baseUrl
}

/**
 * Gives the baseUrl in the website configuration.
 * Contains a Suspense that then awaits io() so that it won't be rendered at build time.
 */
export function BaseUrl() {
  return (
    <Suspense fallback={<>&nbsp;</>}>
      <AsyncBaseUrl />
    </Suspense>
  )
}
