'use client'

import { catchError } from 'next/error'
import { type ReactNode, Suspense } from 'react'

import ErrorBox from './ErrorBox'

function ErrorFallback(props: { fallback: ReactNode }) {
  return <ErrorBox>{props.fallback ?? 'Something went wrong!'}</ErrorBox>
}

const ErrorBoundary = catchError(ErrorFallback)

export default function CatchySuspense(props: { loading: ReactNode; error?: ReactNode; children: ReactNode }) {
  return (
    <ErrorBoundary fallback={props.error}>
      <Suspense fallback={props.loading}>{props.children}</Suspense>
    </ErrorBoundary>
  )
}
