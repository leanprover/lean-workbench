'use client'

import { usePathname } from 'next/navigation'

// n.b. this will want to become more complicated when we have more settings options
export function SettingsBreadcrumb() {
  const pathname = usePathname()
  const breadcrumb = pathname.startsWith('/admin') ? 'Admin settings' : 'Settings'

  return (
    <>
      <span className='sep'>/</span>
      <span className='breadcrumb last'>{breadcrumb}</span>
    </>
  )
}
