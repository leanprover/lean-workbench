'use client'

import { type CSSProperties, type ReactNode, useState } from 'react'

import { isTrackedCommandRunning } from '@/app/admin/actions'
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
  initiallyWatchingTTY: boolean
  successButtonText?: string
  successButtonAction?: (props: { close: () => void }) => void
  trackedCommandAction: (formData: FormData) => Promise<ActionResponse<boolean>>
}

type FormState =
  | { type: 'closed' }
  | { type: 'opening' /* In the process of checking if there's already a command running */ }
  | { type: 'editing' }
  | { type: 'watching'; exit?: TrackedCommandExit }
  | { type: 'conflict' /* Submission blocked because a separate command-run started */ }

export default function TrackedCommandForm({
  streamCommandKey,
  style,
  title,
  children,
  disabled,
  initiallyWatchingTTY,
  successButtonAction,
  successButtonText,
  trackedCommandAction,
}: TrackedCommandFormProps) {
  const [state, setState] = useState<FormState>(initiallyWatchingTTY ? { type: 'watching' } : { type: 'closed' })
  const [submitError, submitAction, submitPending] = useServerAction(
    trackedCommandAction,
    wasCommandCreationSuccessful =>
      setState(wasCommandCreationSuccessful ? { type: 'watching' } : { type: 'conflict' }),
  )

  const { throwToBoundary } = useThrowToBoundary()
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
        <SimpleTTY streamingCommandKey={streamCommandKey} onExit={exit => setState({ type: 'watching', exit })} />
        <div className='actions'>
          {(state.exit?.type === 'killed' || state.exit?.type === 'error') && (
            <button className='primary' disabled={submitPending} onClick={setStateOpening}>
              Back
            </button>
          )}
          {state.exit?.type === 'success' && successButtonText && successButtonAction && (
            <button
              disabled={submitPending}
              className='primary'
              onClick={() => successButtonAction({ close: () => setState({ type: 'closed' }) })}
            >
              {successButtonText}
            </button>
          )}
          {(state.exit?.type !== 'success' || !successButtonText || !successButtonAction) && (
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
