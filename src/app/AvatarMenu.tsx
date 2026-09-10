'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { DropdownMenu } from 'radix-ui'

import AvatarIcon from '@/app/components/AvatarIcon'
import authClient from '@/lib/client/auth'
import { useThrowToBoundary } from '@/lib/client/util'
import { useConfigCtx } from '@/lib/contexts'
import { setIsAdmin } from '@/lib/server/actions'

export default function AvatarMenu() {
  const session = authClient.useSession()
  const cfg = useConfigCtx()
  const router = useRouter()
  const { throwToBoundary } = useThrowToBoundary()
  const isInSetup = usePathname().startsWith('/setup')

  if (session.data && !isInSetup) {
    const user = session.data.user
    return (
      <>
        {user.isAdmin && <span className='admin-badge'>admin</span>}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger className='avatar-btn' aria-label='Account menu'>
            <AvatarIcon user={user} />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content sideOffset={5} className='avatar-dropdown'>
              <DropdownMenu.Label className='avatar-dropdown-user'>{user.name}</DropdownMenu.Label>
              {user.isAdmin && (
                <DropdownMenu.Item asChild>
                  <Link href='/admin'>Admin interface</Link>
                </DropdownMenu.Item>
              )}
              {cfg.isDevMode && (
                <DropdownMenu.Item
                  onSelect={() => {
                    setIsAdmin(!user.isAdmin)
                      .then(() => window.location.reload())
                      .catch(throwToBoundary)
                  }}
                >
                  {user.isAdmin ? '[DEV] Become non-admin' : '[DEV] Become admin'}
                </DropdownMenu.Item>
              )}
              <DropdownMenu.Item
                onSelect={() => {
                  authClient.signOut({ fetchOptions: { onSuccess: () => router.push('/') } }).catch(throwToBoundary)
                }}
              >
                Sign out
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </>
    )
  } else if (!session.isPending && cfg.hasGithubAuth) {
    return (
      <button
        onClick={() => {
          authClient.signIn.social({ provider: 'github' }).catch(throwToBoundary)
        }}
      >
        Sign in via GitHub
      </button>
    )
  } else {
    return null
  }
}
