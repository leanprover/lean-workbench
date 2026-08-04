'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'

import AvatarIcon from '@/app/components/AvatarIcon'
import authClient from '@/lib/client/auth'
import { useConfigCtx } from '@/lib/contexts'
import { setIsAdmin } from '@/lib/server/actions'

export default function AvatarMenu() {
  const session = authClient.useSession()
  const cfg = useConfigCtx()
  const router = useRouter()

  if (session.data) {
    const user = session.data.user
    return (
      <>
        {user.isAdmin && <span className='admin-badge'>admin</span>}
        <div className='avatar-menu'>
          <AvatarIcon user={user} />
          <div className='avatar-dropdown'>
            <div className='avatar-dropdown-user'>{user.name}</div>
            {user.isAdmin && <Link href='/admin'>Admin interface</Link>}
            {cfg.isDevMode && (
              <button
                onClick={async () => {
                  await setIsAdmin(!user.isAdmin)
                  await session.refetch()
                }}
              >
                {user.isAdmin ? '[DEV] Become non-admin' : '[DEV] Become admin'}
              </button>
            )}
            <button
              onClick={async () => {
                await authClient.signOut({
                  fetchOptions: {
                    onSuccess: () => {
                      router.push('/')
                    },
                  },
                })
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      </>
    )
  } else if (!session.isPending && cfg.hasGithubAuth) {
    return <button onClick={() => authClient.signIn.social({ provider: 'github' })}>Sign in via GitHub</button>
  } else {
    return <></>
  }
}
