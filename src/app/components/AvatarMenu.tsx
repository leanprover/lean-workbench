'use client'

import { faGithub } from '@fortawesome/free-brands-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { usePathname, useRouter } from 'next/navigation'
import { Button, Header, Menu, MenuItem, MenuSection, MenuTrigger, Popover } from 'react-aria-components'

import { AvatarIcon } from '@/app/components/AvatarIcon'
import { MenuLinkItem } from '@/app/components/MenuLinkItem'
import { authClient, githubSignin, useReloadSession } from '@/lib/client/auth'
import { useThrowToBoundary } from '@/lib/client/util'
import { useConfigCtx } from '@/lib/contexts'
import { setIsAdmin } from '@/lib/server/actions'

export function AvatarMenu() {
  const session = authClient.useSession()
  const cfg = useConfigCtx()
  const reloadSession = useReloadSession()
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
            <Popover className='dropdown-popover' placement='bottom end' offset={4}>
              <Menu>
                <MenuSection>
                  <Header>{user.name}</Header>
                  <MenuLinkItem href={`/${user.name}`}>Projects</MenuLinkItem>
                  <MenuLinkItem href='/settings'>User settings</MenuLinkItem>
                  {user.isAdmin && <MenuLinkItem href='/admin'>Admin settings</MenuLinkItem>}
                  {cfg.isDevMode && (
                    <MenuItem
                      onAction={() => {
                        setIsAdmin(!user.isAdmin)
                          .then(() => reloadSession())
                          .catch(throwToBoundary)
                      }}
                    >
                      [DEV] Become {user.isAdmin && 'non-'}admin
                    </MenuItem>
                  )}
                  <MenuItem
                    onAction={() => {
                      authClient
                        .signOut({
                          fetchOptions: {
                            onSuccess: () => {
                              // A full-page reload, instead of the router-push eslint is recommending, is recommended for logout flows:
                              // https://nextjs.org/docs/app/guides/preserving-ui-state#state-and-authentication
                              // (The reload also invalidates a client-side cache that learned to redirect `/` to `/:userName`.)
                              // eslint-disable-next-line @next/next/no-location-assign-relative-destination
                              window.location.assign('/')
                            },
                          },
                        })
                        .catch(throwToBoundary)
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
  } else if (!session.isPending && cfg.hasGitHubAuth) {
    return (
      <button onClick={() => githubSignin().catch(throwToBoundary)}>
        <FontAwesomeIcon icon={faGithub} /> Sign in via GitHub
      </button>
    )
  } else {
    return <></>
  }
}
