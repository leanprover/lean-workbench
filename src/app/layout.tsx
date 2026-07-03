import '@/css/app.css'

import type { Metadata } from 'next'
import { Open_Sans } from 'next/font/google'
import Image from 'next/image'
import Link from 'next/link'
import { connection } from 'next/server'
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
  // https://nextjs.org/docs/app/getting-started/caching#opting-out-of-the-static-shell
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
  // NOTE: together with the Suspense above, this makes the entire app dynamic:
  // nothing is pre-rendered and every request recomputes its output HTML.
  // This means we don't have to worry about cache invalidation,
  // but will need fixing if it becomes a perf issue.
  await connection()

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
