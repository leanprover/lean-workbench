'use client'

import authClient from '@/lib/auth-client'
import { ConfigCtx } from '@/lib/contexts'
import { setIsAdmin } from '@/lib/server/actions'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useContext } from 'react'

export default function AvatarMenu() {
  const session = authClient.useSession()
  const cfg = useContext(ConfigCtx)
  const router = useRouter()

  if (session.data) {
    const user = session.data.user
    return (
      <>
        {user.isAdmin && <span className='admin-badge'>admin</span>}
        <div className='avatar-menu'>
          <button className='avatar-btn'>
            {user.image ? (
              <Image src={user.image} alt={user.name} width={28} height={28} loading='eager' />
            ) : (
              <span className='avatar-placeholder'>{user.name[0].toUpperCase()}</span>
            )}
          </button>
          <div className='avatar-dropdown'>
            <div className='avatar-dropdown-user'>{user.name}</div>
            {user.isAdmin && <Link href='/admin'>Admin interface</Link>}
            {cfg.isDevMode && (
              <button
                onClick={async () => {
                  await setIsAdmin(!user.isAdmin)
                  session.refetch()
                }}
              >
                {user.isAdmin ? '[DEV] Become non-admin' : '[DEV] Become admin'}
              </button>
            )}
            <button
              onClick={() => {
                authClient.signOut({
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
