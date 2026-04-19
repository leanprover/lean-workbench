'use client'

import type { Route } from 'next'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Fragment, Suspense } from 'react'

export function Breadcrumbs() {
  return (
    <Suspense fallback={<></>}>
      <BreadcrumbsBody />
    </Suspense>
  )
}

function BreadcrumbsBody() {
  const pathname = usePathname()
  const segments = pathname.split('/').filter(c => c !== '')
  return (
    <>
      {segments.map((segment, i) => {
        const href = '/' + segments.slice(0, i + 1).join('/') + '/'
        return (
          <Fragment key={href}>
            <span className='sep'>/</span>
            <Link className={'breadcrumb ' + (i + 1 === segments.length ? 'last ' : '')} href={href as Route}>
              {decodeURIComponent(segment)}
            </Link>
          </Fragment>
        )
      })}
    </>
  )
}
