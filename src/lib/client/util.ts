import type { ActionResponse } from '@/lib/util'
import { useActionState } from 'react'

/** Returns `[error, dispatchAction, pending]`. */
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
