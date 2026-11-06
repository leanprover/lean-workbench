'use client'

interface ErrorBoundaryProps {
  error: Error & { digest?: string }
}

/**
 * Error boundary for the app root
 * https://nextjs.org/docs/app/api-reference/file-conventions/error#global-error
 */
export default function GlobalError({ error }: ErrorBoundaryProps) {
  return (
    <html lang='en'>
      <body>
        <h1>Something went wrong!</h1>
        {!error.digest && <p>An unexpected error occurred: {error.message}</p>}
        {error.digest && <p>(Error code {error.digest})</p>}
        <p>Contact your administrator if you continue to see this message.</p>
      </body>
    </html>
  )
}
