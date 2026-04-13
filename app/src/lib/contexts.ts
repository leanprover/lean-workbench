import { createContext, type ReactNode } from 'react'

/** Use this in client components to set breadcrumbs in the navbar. */
export const BreadcrumbsCtx = createContext<(_: ReactNode) => void>(() => {})
