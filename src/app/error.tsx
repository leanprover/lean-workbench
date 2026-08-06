'use client'

import { useEffect } from 'react'
import { useSWRConfig } from 'swr'

import ErrorBox from './components/ErrorBox'

interface ErrorBoundaryProps {
  error: Error & { digest?: string }
  retry: () => void
}

/**
 * App-level error boundary
 * https://nextjs.org/docs/app/api-reference/file-conventions/error
 */
export default function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const { mutate } = useSWRConfig()
  useEffect(() => {
    console.error('Unhandled error:', error, error.digest)
  }, [error])

  return (
    <div>
      <h1>Something went wrong!</h1>
      <ErrorBox>
        {error.digest && (
          <p>
            Something went wrong on the server. Try again, or contact your administrator with the error code{' '}
            {error.digest} if the problem persists.
          </p>
        )}
        {!error.digest && <p>An unexpected error occurred: {error.message}</p>}
      </ErrorBox>
      <button
        onClick={async () => {
          try {
            // Invalidate all SWR state, but don't re-fetch automatically
            await mutate(() => true, undefined, { revalidate: false })
          } catch (e) {
            console.error('Failed to clear SWR cache', e)
          }

          //Attempt to recover by re-rendering
          retry()
        }}
      >
        Try again
      </button>
    </div>
  )
}
