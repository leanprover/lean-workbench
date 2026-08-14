import '@/css/app.css'

import type { Metadata } from 'next'
import { io } from 'next/cache'
import { Open_Sans } from 'next/font/google'
import Image from 'next/image'
import Link from 'next/link'
import { type ReactNode, Suspense } from 'react'

import { ConfigCtxProvider } from '@/app/components/ConfigCtxProvider'

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
  return (
    <html lang='en' className={openSans.className}>
      <NavbarExtraProvider>
        <body>
          <nav>
            <Link className='logo' href='/'>
              <Image src='/static/lean-logo.svg' alt='Lean logo' width={70} height={16} loading='eager' />
              <span className='logo-text'>Lean Workbench</span>
            </Link>
            <Breadcrumbs />
            <span className='spacer'></span>
            <Suspense fallback={null}>
              <ConfigCtxProvider>
                <NavbarExtra />
                <AvatarMenu />
              </ConfigCtxProvider>
            </Suspense>
          </nav>
          <main style={{ maxWidth: '600px' }}>
            <Suspense fallback={null}>
              <ConfigCtxProvider>{children}</ConfigCtxProvider>
            </Suspense>
          </main>
        </body>
      </NavbarExtraProvider>
    </html>
  )
}
