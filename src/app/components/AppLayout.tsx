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

  /** Class name applied to the `<main>` component */
  mainClass?: string
}

export function AppLayout({ breadcrumbs, children, title, suspend, mainClass }: AppLayoutProps) {
  return (
    <>
      <Navbar breadcrumbs={breadcrumbs} />
      <main className={mainClass}>
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
