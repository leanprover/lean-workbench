import WithNavbar from '@/component/WithNavbar'
import '@/css/app.css'
import type { Metadata } from 'next'
import { type ReactNode } from 'react'

export const metadata: Metadata = {
  title: 'Lean Workbench',
  description: 'Web platform for Lean',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode
}>) {
  return (
    <html lang="en">
      <body>
        {/* "Donut pattern": WithNavbar must be RCC, children can be RSCs */}
        <WithNavbar>
          <main style={{ maxWidth: '600px' }}>{children}</main>
        </WithNavbar>
      </body>
    </html>
  )
}
