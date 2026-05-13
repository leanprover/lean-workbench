'use client'

import React, { createContext, type ReactNode, type RefObject, use, useLayoutEffect, useRef, useState } from 'react'

type Setter = (_: ReactNode) => void
const NavbarExtraSetCtx = createContext<RefObject<Setter> | null>(null)

export function NavbarExtraProvider({ children }: Readonly<{ children: ReactNode }>) {
  const ref = useRef<Setter>(() => {
    console.warn('useNavbarExtra called before <NavbarExtra /> mounted')
  })
  return <NavbarExtraSetCtx value={ref}>{children}</NavbarExtraSetCtx>
}

/** Renders extra contents of the navbar as set by specific pages.
 * This component and the page that uses {@link SetNavbarExtra}
 * must share a {@link NavbarExtraProvider} parent */
export function NavbarExtra() {
  const [extra, setExtra] = useState<ReactNode>(null)
  const ref = use(NavbarExtraSetCtx)!
  useLayoutEffect(() => {
    ref.current = setExtra
  }, [ref, setExtra])
  return extra
}

/** Sets extra contents of the navbar to its children. */
export function SetNavbarExtra({ children }: Readonly<{ children: ReactNode }>) {
  const ref = use(NavbarExtraSetCtx)!
  React.useEffect(() => {
    ref.current(children)
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      ref.current(null)
    }
  }, [ref, children])
  return null
}
