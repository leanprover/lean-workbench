'use client'

import { usePathname, useRouter } from 'next/navigation'
import { Button, Header, Menu, MenuItem, MenuSection, MenuTrigger, Popover } from 'react-aria-components'

import AvatarIcon from '@/app/components/AvatarIcon'
import MenuLinkItem from '@/app/components/MenuLinkItem'
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

  if (session.data) {
    const user = session.data.user
    return (
      <>
        {user.isAdmin && <span className='admin-badge'>admin</span>}
        {isInSetup ? (
          <span className='avatar-btn'>
            <AvatarIcon user={user} />
          </span>
        ) : (
          <MenuTrigger>
            <Button className='avatar-btn' aria-label='Account menu'>
              <AvatarIcon user={user} />
            </Button>
            <Popover className='avatar-dropdown' placement='bottom end' offset={4}>
              <Menu>
                <MenuSection>
                  <Header>{user.name}</Header>
                  {user.isAdmin && <MenuLinkItem href='/admin'>Admin interface</MenuLinkItem>}
                  {cfg.isDevMode && (
                    <MenuItem
                      onAction={() => {
                        setIsAdmin(!user.isAdmin)
                          .then(() => window.location.reload())
                          .catch(throwToBoundary)
                      }}
                    >
                      [DEV] Become {user.isAdmin && 'non-'}admin
                    </MenuItem>
                  )}
                  <MenuItem
                    onAction={() => {
                      authClient.signOut({ fetchOptions: { onSuccess: () => router.push('/') } }).catch(throwToBoundary)
                    }}
                  >
                    Sign out
                  </MenuItem>
                </MenuSection>
              </Menu>
            </Popover>
          </MenuTrigger>
        )}
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
    return <></>
  }
}
