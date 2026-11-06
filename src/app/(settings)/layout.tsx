import { type ReactNode } from 'react'

import { Navbar } from '@/app/components/Navbar'

import { SettingsBreadcrumb } from './SettingsBreadcrumb'

export default function SettingsLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <>
      <Navbar breadcrumbs={<SettingsBreadcrumb />} />
      <main className='settings'>
        <section>{children}</section>
      </main>
    </>
  )
}
