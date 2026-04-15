'use client'

import { createContext, useContext, useState, type ReactNode } from 'react'

const BreadcrumbsValCtx = createContext<ReactNode>(null)
const BreadcrumbsSetCtx = createContext<(_: ReactNode) => void>(() => {})

/** Use to set breadcrumbs in the navbar. */
export function useSetBreadcrumbs(): (_: ReactNode) => void {
  return useContext(BreadcrumbsSetCtx)
}

export function WithBreadcrumbsCtx({ children }: Readonly<{ children: ReactNode }>) {
  const [breadcrumbs, setBreadcrumbs] = useState<ReactNode>(null)
  return (
    <BreadcrumbsSetCtx value={setBreadcrumbs}>
      <BreadcrumbsValCtx value={breadcrumbs}>{children}</BreadcrumbsValCtx>
    </BreadcrumbsSetCtx>
  )
}

export function Breadcrumbs() {
  return useContext(BreadcrumbsValCtx)
}
