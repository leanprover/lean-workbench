import { type ReactNode } from 'react'

import { AppLayout } from '@/app/components/AppLayout'

export default function SetupLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <AppLayout
      suspend
      breadcrumbs={
        <>
          <span className='sep'>/</span>
          <span className='breadcrumb last'>Initial Setup</span>
        </>
      }
    >
      {children}
    </AppLayout>
  )
}
