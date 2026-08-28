'use client'

import { catchError, type ErrorInfo } from 'next/error'
import { type ReactNode, Suspense } from 'react'
import z from 'zod'

import ErrorBox from './ErrorBox'

function ErrorFallback(props: { fallback?: ReactNode | ((err: unknown) => ReactNode) }, { error, retry }: ErrorInfo) {
  let displayedError: ReactNode
  if (props.fallback !== undefined) {
    displayedError = typeof props.fallback === 'function' ? props.fallback(error) : props.fallback
  } else {
    try {
      const { digest, message } = z.object({ digest: z.string(), message: z.string().optional() }).parse(error)
      displayedError =
        process.env.NODE_ENV === 'production' ? (
          `A server-side error occurred (digest ${digest})`
        ) : (
          <>
            <div>Server-side error, in production users will only see the digest {digest}.</div>
            <div>{message}</div>
          </>
        )
    } catch {
      // Presumably a client-side error, parse more like a usual caught exception
      displayedError = error instanceof Error ? error.message : String(error)
    }
  }

  return (
    <ErrorBox>
      <div style={{ display: 'flex', gap: 8, flexDirection: 'column' }}>
        {displayedError}
        <div>
          <button onClick={retry}>Retry</button>
        </div>
      </div>
    </ErrorBox>
  )
}

const ErrorBoundary = catchError(ErrorFallback)

/**
 * Combines a `<Suspense>` boundary with an error boundary derived from Next.js's `catchError`.
 *
 * The `loading` fallback works exactly the Suspense component's `fallback`
 * and is inserted directly into the document.
 *
 * The `error` fallback can be a ReactNode or a function producing a React node from the actual error.
 * (Note: if the <CatchySuspense> is in a server component, the error fallback CANNOT be a function.)
 *
 * Keep in mind that, in production environments, the actual thrown error may originate from the server
 * and so will be an unhelpful digest string with a generic "An error occurred in the Server Components blah blah blah" message.
 */
export default function CatchySuspense(props: {
  loading: ReactNode
  error?: ReactNode | ((err: unknown) => ReactNode)
  children: ReactNode
}) {
  return (
    <ErrorBoundary fallback={props.error}>
      <Suspense fallback={props.loading}>{props.children}</Suspense>
    </ErrorBoundary>
  )
}
