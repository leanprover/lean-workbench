'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Fragment } from 'react'

import { authClient } from '@/lib/client/auth'

import { settings } from './settingsNavData'

export function SettingsNav() {
  const pathname = usePathname()
  const session = authClient.useSession()

  return (
    <nav aria-label='Settings'>
      {settings
        .filter(section => !section.admin || session.data?.user.isAdmin)
        .map(section => (
          <Fragment key={section.title}>
            <h2>{section.title}</h2>
            <ul>
              {section.routes.map(({ href, label }) => (
                <li key={href}>
                  <Link href={href} aria-current={href === pathname ? 'page' : undefined}>
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </Fragment>
        ))}
    </nav>
  )
}
