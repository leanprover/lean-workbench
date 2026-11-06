import { type ReactNode, Suspense } from 'react'

import { ConfigCtxProvider } from './ConfigCtxProvider'
import { Navbar } from './Navbar'

interface AppLayoutProps {
  breadcrumbs?: ReactNode
  title?: ReactNode
  children: ReactNode
  /**
   * If set, the entire body of the AppLayout will suspend
   * and <ConfigCtxProvider> will be available in the entire body.
   */
  suspend?: boolean
}

export function AppLayout({ breadcrumbs, children, title, suspend }: AppLayoutProps) {
  return (
    <>
      <Navbar breadcrumbs={breadcrumbs} />
      <main>
        {title && <h1>{title}</h1>}
        {suspend ? (
          <Suspense>
            <ConfigCtxProvider>{children}</ConfigCtxProvider>
          </Suspense>
        ) : (
          children
        )}
      </main>
    </>
  )
}
