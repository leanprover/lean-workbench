import AvatarMenu from '@/component/AvatarMenu'
import { Breadcrumbs } from '@/component/Breadcrumbs'
import '@/css/app.css'
import { ConfigCtx } from '@/lib/contexts'
import * as CacheTag from '@/lib/server/cacheTags'
import { getConfig, hasGithubAuth, isDevMode } from '@/lib/server/config'
import type { Metadata } from 'next'
import { cacheTag } from 'next/cache'
import { Open_Sans } from 'next/font/google'
import Image from 'next/image'
import Link from 'next/link'
import { type ReactNode } from 'react'

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
  'use cache'
  cacheTag(CacheTag.serverConfig)

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
        <body>
          <nav>
            <Link className='logo' href='/'>
              <Image src='/static/lean-logo.svg' alt='Lean logo' width={70} height={16} loading='eager' />
              <span className='logo-text'>Lean Workbench</span>
            </Link>
            <Breadcrumbs />
            <span className='spacer'></span>
            {serverCfg.isSetupComplete && <AvatarMenu />}
          </nav>
          <main style={{ maxWidth: '600px' }}>{children}</main>
        </body>
      </ConfigCtx>
    </html>
  )
}
