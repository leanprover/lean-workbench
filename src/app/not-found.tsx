import Link from 'next/link'
import { Suspense } from 'react'

import { AppLayout } from '@/app/components/AppLayout'
import { getUserSession } from '@/lib/server/auth'

async function Return() {
  const session = await getUserSession()
  return (
    <p>
      {session && (
        <>
          <Link href={`/${session.user.name}`}>Return to your profile</Link>.
        </>
      )}
      {!session && (
        <>
          <Link href='/'>Return to the home page</Link>.
        </>
      )}
    </p>
  )
}

export default function NotFound() {
  return (
    <AppLayout title='404 Not Found'>
      <p>Page Not Found.</p>
      <Suspense>
        <Return />
      </Suspense>
    </AppLayout>
  )
}
