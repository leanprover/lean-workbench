import { type ReactNode } from 'react'

import { AppLayout } from '@/app/components/AppLayout'

import { Breadcrumbs } from './Breadcrumbs'

export default function UserLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <AppLayout suspend breadcrumbs={<Breadcrumbs />}>
      {children}
    </AppLayout>
  )
}
