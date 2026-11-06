import { type ReactNode, Suspense } from 'react'

import { AvatarMenu } from './AvatarMenu'
import { ConfigCtxProvider } from './ConfigCtxProvider'
import { NavbarShell } from './NavbarShell'

interface NavbarProps {
  breadcrumbs?: ReactNode
}

export function Navbar({ breadcrumbs }: NavbarProps) {
  return (
    <NavbarShell breadcrumbs={breadcrumbs}>
      <Suspense>
        <ConfigCtxProvider>
          <AvatarMenu />
        </ConfigCtxProvider>
      </Suspense>
    </NavbarShell>
  )
}
