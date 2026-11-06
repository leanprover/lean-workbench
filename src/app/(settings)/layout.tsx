import { type ReactNode } from 'react'

import { Navbar } from '@/app/components/Navbar'

import { SettingsBreadcrumb } from './SettingsBreadcrumb'

import { SettingsNav } from './SettingsNav'

export default function SettingsLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <>
      <Navbar breadcrumbs={<SettingsBreadcrumb />} />
      <main className='settings'>
        <aside>
          <SettingsNav />
        </aside>
        <section>{children}</section>
      </main>
    </>
  )
}
