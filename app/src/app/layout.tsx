import ClientRootLayout from '@/component/ClientRootLayout'
import '@/css/app.css'
import { getConfig, hasGithubAuth, isDevMode } from '@/lib/server/config'
import type { Metadata } from 'next'
import { Open_Sans } from 'next/font/google'
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
  }
  return (
    <html lang="en" className={openSans.className}>
      <body>
        {/* "Donut pattern": `ClientRootLayout` must be RCC, children can be RSCs. */}
        <ClientRootLayout cfg={clientCfg}>
          <main style={{ maxWidth: '600px' }}>{children}</main>
        </ClientRootLayout>
      </body>
    </html>
  )
}
