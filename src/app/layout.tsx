import '@/css/app.css'

import type { Metadata } from 'next'
import { io } from 'next/cache'
import { Open_Sans } from 'next/font/google'
import Image from 'next/image'
import Link from 'next/link'
import { type ReactNode, Suspense } from 'react'

import { ConfigCtx } from '@/lib/contexts'
import { getConfig, hasGithubAuth, isDevMode } from '@/lib/server/config'

import AvatarMenu from './AvatarMenu'
import Breadcrumbs from './Breadcrumbs'
import { NavbarExtra, NavbarExtraProvider } from './NavbarExtra'

const openSans = Open_Sans({
  subsets: ['latin'],
  weight: ['400', '600'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Lean Workbench',
  description: 'Web platform for Lean',
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: ReactNode
}>) {
  // FIXME: this is currently the only `Suspense` in the app,
  // so we don't get static shells for any page.
  return (
    <Suspense fallback={null}>
      <RootLayoutBody>{children}</RootLayoutBody>
    </Suspense>
  )
}

async function RootLayoutBody({
  children,
}: Readonly<{
  children: ReactNode
}>) {
  // NOTE: Awaiting `io` makes the root layout dynamic
  // (every request recomputes its output HTML),
  // though static shells for pages may still be pre-rendered by `next build`.
  await io()

  const serverCfg = getConfig()
  const clientCfg = {
    isSetupComplete: serverCfg.isSetupComplete,
    isDevMode: isDevMode(),
    hasGithubAuth: hasGithubAuth(serverCfg),
    registrationMode: serverCfg.registrationMode,
  }
  return (
    <html lang='en' className={openSans.className}>
      {/* https://nextjs.org/docs/app/getting-started/server-and-client-components#interleaving-server-and-client-components */}
      <ConfigCtx value={clientCfg}>
        <NavbarExtraProvider>
          <body>
            <nav>
              <Link className='logo' href='/'>
                <Image src='/static/lean-logo.svg' alt='Lean logo' width={70} height={16} loading='eager' />
                <span className='logo-text'>Lean Workbench</span>
              </Link>
              <Breadcrumbs />
              <span className='spacer'></span>
              <NavbarExtra />
              {serverCfg.isSetupComplete && <AvatarMenu />}
            </nav>
            <main style={{ maxWidth: '600px' }}>{children}</main>
          </body>
        </NavbarExtraProvider>
      </ConfigCtx>
    </html>
  )
}
