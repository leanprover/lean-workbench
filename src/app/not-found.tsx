import Link from 'next/link'

import { getUserSession } from '@/lib/server/auth'

export default async function NotFound() {
  const session = await getUserSession()

  return (
    <div>
      <h1>404 Not Found</h1>
      <p>Page Not Found.</p>
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
    </div>
  )
}
