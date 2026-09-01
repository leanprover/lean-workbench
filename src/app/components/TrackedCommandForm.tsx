'use client'

import { type CSSProperties, type ReactNode, useEffect, useState } from 'react'

import { isTrackedCommandAvailable, isTrackedCommandRunning } from '@/app/admin/actions'
import ErrorBox from '@/app/components/ErrorBox'
import SimpleTTY from '@/app/components/SimpleTTY'
import { useServerAction, useThrowToBoundary } from '@/lib/client/util'
import { type ActionResponse, type TrackedCommandExit } from '@/lib/util'

interface TrackedCommandFormProps {
  streamCommandKey: string
  style?: CSSProperties
  title: string
  children: ReactNode
  disabled?: boolean
  initiallyWatchingTTY?: boolean
  successAction?: () => void
  successButton?: { allowClose?: boolean; text: string; action: (props: { close: () => void }) => void }
  trackedCommandAction: (formData: FormData) => Promise<ActionResponse<boolean>>
}

type FormState =
  | { type: 'closed' }
  | { type: 'opening' /* In the process of checking if there's already a command running */ }
  | { type: 'editing' }
  | { type: 'watching'; exit?: TrackedCommandExit }
  | { type: 'conflict' /* Submission blocked because a separate command-run started */ }

/**
 * Present the admin user with a button labeled with the `title` prop.
 * That button can be expanded to present the body of a <form> (the element's children),
 * that gets submitted to the serverAction `trackedCommandAction`.
 *
 * The expectation is that this server action runs `startTrackedCommand(streamCommandKey, ...)` and
 * returns `true` iff `startTrackedCommand` successfully returns an emitter. The form will then
 * be replaced with the TTY output from the `streamCommandKey`.
 *
 * Optional configuration props:
 *  - `disabled`: forces the form closed, disables the button
 *  - `style`: styles applied to the TrackedCommandForm
 *  - `initiallyWatchingTTY`: begin in an open state, try to open the TTY view first, and
 *    fall back on the form view only if no prior TTY session is available.
 *  - `successAction`: runs immediately if an successful-exit is detected (whether via replay
 *    or via a new streaming event)
 *  - `successButton`: if provided, then when the TTY is showing a successful exit state, the
 *    "Close" button will be replaced (or augmented, if `successButton.allowClose` is true) with
 *    a button that contains `successButton.text` and performs `successButton.action` on click.
 */
export default function TrackedCommandForm({
  streamCommandKey,
  style,
  title,
  children,
  disabled,
  initiallyWatchingTTY,
  successAction,
  successButton,
  trackedCommandAction,
}: TrackedCommandFormProps) {
  const [state, setState] = useState<FormState>(initiallyWatchingTTY ? { type: 'opening' } : { type: 'closed' })
  const [submitError, submitAction, submitPending] = useServerAction(
    trackedCommandAction,
    wasCommandCreationSuccessful =>
      setState(wasCommandCreationSuccessful ? { type: 'watching' } : { type: 'conflict' }),
  )

  const { throwToBoundary } = useThrowToBoundary()
  useEffect(() => {
    if (disabled || !initiallyWatchingTTY) return
    isTrackedCommandAvailable(streamCommandKey)
      .then(isTTYAvailable => setState(isTTYAvailable ? { type: 'watching' } : { type: 'editing' }))
      .catch(throwToBoundary)
  }, [disabled, initiallyWatchingTTY, streamCommandKey, throwToBoundary])
  const setStateOpening = () => {
    setState({ type: 'opening' })
    isTrackedCommandRunning(streamCommandKey)
      .then(isAlreadyRunning => setState(isAlreadyRunning ? { type: 'watching' } : { type: 'editing' }))
      .catch(throwToBoundary)
  }

  if (state.type === 'closed' || disabled) {
    return (
      <div className='command-setup-button' style={style}>
        <button disabled={disabled} className='primary' onClick={setStateOpening}>
          {title}
        </button>
      </div>
    )
  }

  const titleNode = (
    <div style={{ paddingBottom: '5px', marginBottom: '5px', borderBottom: '1px solid #e4ebf3' }}>{title}</div>
  )
  if (state.type === 'opening') {
    return (
      <div className='command-setup-form' style={style}>
        {titleNode}
      </div>
    )
  }

  if (state.type === 'watching') {
    return (
      <div className='command-setup-form' style={style}>
        {titleNode}
        <SimpleTTY
          streamingCommandKey={streamCommandKey}
          onExit={exit => {
            if (exit.type === 'success') successAction?.()
            setState({ type: 'watching', exit })
          }}
        />
        <div className='actions'>
          {(state.exit?.type === 'killed' || state.exit?.type === 'error') && (
            <button className='primary' disabled={submitPending} onClick={setStateOpening}>
              Back
            </button>
          )}
          {state.exit?.type === 'success' && successButton && (
            <button
              disabled={submitPending}
              className='primary'
              onClick={() => successButton.action({ close: () => setState({ type: 'closed' }) })}
            >
              {successButton.text}
            </button>
          )}
          {(state.exit?.type !== 'success' || !successButton || successButton.allowClose) && (
            <button disabled={submitPending} onClick={() => setState({ type: 'closed' })}>
              Close
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <form action={submitAction} className='command-setup-form' style={style}>
      {titleNode}
      {children}
      <div style={{ color: '#f00' }}>{submitError}</div>
      {state.type === 'conflict' && (
        <ErrorBox>
          Cannot start this command because another command of the same type is already running. You can wait and try
          again once the running command finishes, or you can view the command run in progress.
        </ErrorBox>
      )}
      <div className='actions'>
        {state.type === 'conflict' && (
          <button type='button' onClick={() => setState({ type: 'watching' })}>
            View command in progress
          </button>
        )}
        <button type='button' disabled={submitPending} onClick={() => setState({ type: 'closed' })}>
          Cancel
        </button>
        <button disabled={submitPending} className='primary' type='submit'>
          Run Command
        </button>
      </div>
    </form>
  )
}
