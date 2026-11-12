import Image from 'next/image'
import Link from 'next/link'
import { type ReactNode, Suspense } from 'react'

interface NavbarShellProps {
  breadcrumbs?: ReactNode
  children?: ReactNode
}

/**
 * The full navbar includes an AvatarMenu,
 * but the error page renders without an AvatarMenu
 * (because it does not have access to a ConfigCtx through the ConfigCtxProvider).
 *
 * The NavbarShell allows the AvatarMenu to be omitted or replaced.
 */
export function NavbarShell({ breadcrumbs, children }: NavbarShellProps) {
  return (
    <nav className='top' aria-label='Primary'>
      <Link className='logo' href='/'>
        <Image src='/static/lean-logo.svg' alt='Lean logo' width={70} height={16} loading='eager' />
        <span className='logo-text'>Lean Workbench</span>
      </Link>
      <Suspense>{breadcrumbs}</Suspense>
      <span className='spacer' />
      {children}
    </nav>
  )
}
