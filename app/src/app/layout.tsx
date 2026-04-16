import AvatarMenu from '@/component/AvatarMenu'
import { Breadcrumbs, WithBreadcrumbsCtx } from '@/component/Breadcrumbs'
import '@/css/app.css'
import { ConfigCtx } from '@/lib/contexts'
import { getConfig, hasGithubAuth, isDevMode } from '@/lib/server/config'
import type { Metadata } from 'next'
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

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode
}>) {
  const serverCfg = getConfig()
  const clientCfg = {
    isSetupComplete: serverCfg.isSetupComplete,
    isDevMode: isDevMode(),
    hasGithubAuth: hasGithubAuth(serverCfg),
    registrationMode: serverCfg.registrationMode,
  }
  return (
    <html lang='en' className={openSans.className}>
      <ConfigCtx value={clientCfg}>
        {/* https://nextjs.org/docs/app/getting-started/server-and-client-components#interleaving-server-and-client-components */}
        <WithBreadcrumbsCtx>
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
        </WithBreadcrumbsCtx>
      </ConfigCtx>
    </html>
  )
}
