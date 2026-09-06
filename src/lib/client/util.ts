import 'client-only'

import { useActionState, useState } from 'react'
import useSWR, { type Key, type SWRConfiguration, type SWRResponse } from 'swr'

import { type ActionResponse, unknownAsError } from '@/lib/util'

/**
 * Adapts a server function that returns an `ActionResponse`
 * into a React Action form that tracks pending status and error status.
 *
 * Returns `[error, dispatchAction, pending]`.
 */
export function useServerAction<Payload = void, T = void>(
  fn: (payload: Payload) => Promise<ActionResponse<T>>,
  onSuccess?: (_: T) => void,
) {
  return useActionState(async (_: string | null, payload: Payload) => {
    const result = await fn(payload)
    if ('error' in result) return result.error
    onSuccess?.(result.ok)
    return null
  }, null)
}

/**
 * Creates a callback that will throw from the render phase.
 * In a callback, `foo().then(bar)` might silently ignore errors;
 * whereas `foo().then(bar).catch(rethrow)` will ensure the error is thrown to an error boundary.
 */
export function useThrowToBoundary(): { throwToBoundary: (error: unknown) => void } {
  const [error, setError] = useState<unknown>()
  if (error !== undefined) {
    throw unknownAsError(error)
  }
  return { throwToBoundary: setError }
}

/**
 * Wrap useSWR hook to ensure that any error thrown in the handler will be thrown to the closest error boundary.
 * Providing `fallbackData` ensures you don't have to deal with undefined `data`.
 */
export function useThrowingSWR<T>(
  key: Key,
  fetcher: () => Promise<T>,
  config: Omit<SWRConfiguration<T, unknown>, 'fallbackData'> & { fallbackData: T },
): SWRResponse<T, unknown> & { data: T }

/**
 * Wrap useSWR hook to ensure that any error thrown in the handler will be thrown to the closest error boundary.
 * Suspending until data is available ensures you don't have to deal with undefined `data`.
 */
export function useThrowingSWR<T>(
  key: Key,
  fetcher: () => Promise<T>,
  config: Omit<SWRConfiguration<T, unknown>, 'fallbackData'> & { suspense: true },
): SWRResponse<T, unknown> & { data: T }

/**
 * Wrap useSWR hook to ensure that any error thrown in the handler will be thrown to the closest error boundary.
 */
export function useThrowingSWR<T>(
  key: Key,
  fetcher: () => Promise<T>,
  config?: Omit<SWRConfiguration<T, unknown>, 'fallbackData'>,
): SWRResponse<T, unknown>

export function useThrowingSWR<T>(key: Key, fetcher: () => Promise<T>, config?: SWRConfiguration<T, unknown>) {
  const fallbackData = config?.fallbackData
  const result = useSWR<T, unknown>(key, () => fetcher(), { ...config, fallbackData: undefined })
  // On a background revalidation (like when the window refocuses), result.data will be defined
  // Don't throw if such a background revalidation fails, just continue returning the (stale) data.
  if (result.error !== undefined) {
    if (result.data === undefined) {
      throw unknownAsError(result.error)
    }
    console.error(`Background revalidation failed for ${key}, reusing old value`, result.error)
  }
  if (result.data === undefined) return { ...result, data: fallbackData }
  return result
}
