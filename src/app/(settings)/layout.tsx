import { type ReactNode } from 'react'

import { ConfigCtxProvider } from '@/app/components/ConfigCtxProvider'
import { Navbar } from '@/app/components/Navbar'
import { NavigationSafeSuspense } from '@/app/components/NavigationSafeSuspense'

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
        <NavigationSafeSuspense>
          <ConfigCtxProvider>
            <section>{children}</section>
          </ConfigCtxProvider>
        </NavigationSafeSuspense>
      </main>
    </>
  )
}
