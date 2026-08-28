'use client'

import { catchError, type ErrorInfo } from 'next/error'
import { type ReactNode, Suspense } from 'react'
import z from 'zod'

import ErrorBox from './ErrorBox'

function ErrorFallback(props: { fallback?: (err: unknown) => ReactNode }, errorInfo: ErrorInfo) {
  console.log(errorInfo)
  const parsedError = z
    .object({ digest: z.string().optional(), message: z.string().optional() })
    .safeParse(errorInfo.error)
  const message = props.fallback ? (
    props.fallback(errorInfo.error)
  ) : !parsedError.success ? (
    'Something unexpected went wrong!'
  ) : parsedError.data.digest ? (
    process.env.NODE_ENV === 'production' ? (
      `A server-side error occurred (digest ${parsedError.data.digest})`
    ) : (
      <>
        <div>Server-side error, in production users will only see the digest {parsedError.data.digest}.</div>
        <div>{parsedError.data.message}</div>
      </>
    )
  ) : (
    (parsedError.data.message ?? 'Something unexpected went wrongs!')
  )

  return (
    <ErrorBox>
      <div style={{ display: 'flex', gap: 8, flexDirection: 'column' }}>
        {message}
        <div>
          <button onClick={errorInfo.retry}>Retry</button>
        </div>
      </div>
    </ErrorBox>
  )
}

const ErrorBoundary = catchError(ErrorFallback)

/**
 * Combines a `<Suspense>` boundary with an error boundary derived from Next.js's `catchError`.
 *
 * The `loading` prop works exactly the Suspense component's `fallback`
 * and is inserted directly into the document.
 *
 * The error message is derived from the thrown error, via the `error` parameter if it is provided.
 * Keep in mind that, in most cases, the actual thrown error will originate from the server
 * and so will be an unhelpful digest string with a generic "An error occurred in the Server Components blah blah blah" message.
 */
export default function CatchySuspense(props: {
  loading: ReactNode
  error?: (err: unknown) => ReactNode
  children: ReactNode
}) {
  return (
    <ErrorBoundary fallback={props.error}>
      <Suspense fallback={props.loading}>{props.children}</Suspense>
    </ErrorBoundary>
  )
}
