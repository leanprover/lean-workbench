import '@/css/app.css'

import type { Metadata } from 'next'
import { Open_Sans } from 'next/font/google'
import { type ReactNode } from 'react'

const openSans = Open_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Lean Workbench',
  description: 'Web platform for Lean',
}

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang='en' className={openSans.className}>
      <body>{children}</body>
    </html>
  )
}
