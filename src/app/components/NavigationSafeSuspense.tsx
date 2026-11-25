'use client'

import { useSelectedLayoutSegments } from 'next/navigation'
import { Suspense, type SuspenseProps } from 'react'

/**
 * Workaround for https://github.com/react/react/issues/36594.
 * A suspense should be replaced by `NavigationSafeSuspense` if a page navigation event might change the expected contents of the suspense before the suspense finishes loading.
 * If a page navigation would remove the suspense component itself, the workaround is not necessary.
 */
export function NavigationSafeSuspense(props: SuspenseProps) {
  'use no memo'
  // useSelectedLayoutSegments forces the suspense to re-render if the route changes
  useSelectedLayoutSegments()
  return <Suspense {...props} />
}
