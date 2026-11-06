import '@/css/app.css'

import type { Metadata } from 'next'
import { Open_Sans } from 'next/font/google'
import Image from 'next/image'
import Link from 'next/link'
import { type ReactNode, Suspense } from 'react'

import { ConfigCtxProvider } from '@/app/components/ConfigCtxProvider'

import { AvatarMenu } from './AvatarMenu'
import { Breadcrumbs } from './Breadcrumbs'

const openSans = Open_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
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
      <body>
        <nav>
          <Link className='logo' href='/'>
            <Image src='/static/lean-logo.svg' alt='Lean logo' width={70} height={16} loading='eager' />
            <span className='logo-text'>Lean Workbench</span>
          </Link>
          <Suspense fallback={null}>
            <Breadcrumbs />
          </Suspense>
          <span className='spacer'></span>
          <Suspense fallback={null}>
            <ConfigCtxProvider>
              <AvatarMenu />
            </ConfigCtxProvider>
          </Suspense>
        </nav>
        <main style={{ maxWidth: '600px' }}>
          {/* FIXME: we currently don't get static shells for any page due to this `Suspense`. */}
          <Suspense fallback={null}>
            <ConfigCtxProvider>{children}</ConfigCtxProvider>
          </Suspense>
        </main>
      </body>
    </html>
  )
}
