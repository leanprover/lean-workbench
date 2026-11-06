import { type ReactNode, Suspense } from 'react'

import { ConfigCtxProvider } from '@/app/components/ConfigCtxProvider'
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
        <Suspense>
          <ConfigCtxProvider>
            <section>{children}</section>
          </ConfigCtxProvider>
        </Suspense>
      </main>
    </>
  )
}
