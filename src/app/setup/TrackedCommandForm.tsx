'use client'

import { useRouter } from 'next/navigation'
import { type CSSProperties, type ReactNode, use, useState } from 'react'

import CatchySuspense from '@/app/components/CatchySuspense'
import ErrorBox from '@/app/components/ErrorBox'
import SimpleTTY from '@/app/components/SimpleTTY'
import { useServerAction } from '@/lib/client/util'
import { type ActionResponse, type TrackedCommandExit } from '@/lib/util'

import { isTrackedCommandRunning } from './actions'

interface TrackedCommandFormProps {
  streamCommandKey: string
  style?: CSSProperties
  title: string
  children: ReactNode
  disabled?: boolean
  successButtonText?: string
  successButtonAction?: () => void
  trackedCommandAction: (formData: FormData) => Promise<ActionResponse<boolean>>
}

/** When we open a form, we issue a check whether that form has a running command */
type FormOpenState = { type: 'closed' } | { type: 'open'; isRunningWhenOpenedPromise: Promise<boolean> }

type FormRunState = 'none' | 'conflict' | 'watching'

export default function TrackedCommandForm({
  streamCommandKey,
  style,
  title,
  children,
  disabled,
  successButtonAction,
  successButtonText,
  trackedCommandAction,
}: TrackedCommandFormProps) {
  const router = useRouter()
  const [state, setState] = useState<FormOpenState>({ type: 'closed' })
  const [formRunState, setFormRunState] = useState<FormRunState>('none')
  const [attempt, setAttempt] = useState(0)
  const [submitError, submitAction, submitPending] = useServerAction(
    trackedCommandAction,
    wasCommandCreationSuccessful => setFormRunState(wasCommandCreationSuccessful ? 'watching' : 'conflict'),
  )

  if (state.type === 'closed' || disabled) {
    return (
      <div style={style}>
        <button
          disabled={disabled}
          className='primary'
          onClick={() =>
            setState({ type: 'open', isRunningWhenOpenedPromise: isTrackedCommandRunning(streamCommandKey) })
          }
        >
          {title}
        </button>
      </div>
    )
  }

  return (
    <form action={submitAction} className='command-setup-form'>
      <div style={{ paddingBottom: '5px', marginBottom: '5px', borderBottom: '1px solid #e4ebf3' }}>{title}</div>
      <CatchySuspense loading={null}>
        <TrackedCommandFormContents
          key={attempt}
          formRunState={formRunState}
          submitPending={submitPending}
          isRunningWhenOpenedPromise={state.isRunningWhenOpenedPromise}
          streamCommandKey={streamCommandKey}
          close={() => {
            setState({ type: 'closed' })
            setFormRunState('none')
            router.refresh()
          }}
          watch={() => setFormRunState('watching')}
          unwatch={() => {
            setFormRunState('none')
            setAttempt(attempt => attempt + 1) // Heavy-handed re-mount of TrackedCommandFormContents
          }}
          successButtonText={successButtonText}
          successButtonAction={successButtonAction}
          submitError={submitError}
        >
          {children}
        </TrackedCommandFormContents>
      </CatchySuspense>
    </form>
  )
}

function TrackedCommandFormContents(props: {
  submitPending: boolean
  streamCommandKey: string
  isRunningWhenOpenedPromise: Promise<boolean>
  formRunState: FormRunState
  close: () => void
  watch: () => void
  unwatch: () => void
  successButtonText?: string
  successButtonAction?: () => void
  submitError: string | null
  children: ReactNode
}) {
  const isRunningWhenOpened = use(props.isRunningWhenOpenedPromise)
  const [exit, setExit] = useState<null | TrackedCommandExit>(null)

  if (isRunningWhenOpened || props.formRunState === 'watching') {
    return (
      <>
        <SimpleTTY streamingCommandKey={props.streamCommandKey} onExit={setExit} />
        <div className='actions'>
          {(exit?.type === 'killed' || exit?.type === 'error') && (
            <button
              className='primary'
              disabled={props.submitPending}
              onClick={e => {
                e.preventDefault()
                props.unwatch()
              }}
            >
              Back
            </button>
          )}
          {exit?.type === 'success' && props.successButtonText && props.successButtonAction && (
            <button
              disabled={props.submitPending}
              className='primary'
              onClick={e => {
                e.preventDefault()
                props.close()
                props.successButtonAction?.()
              }}
            >
              {props.successButtonText}
            </button>
          )}
          <button
            disabled={props.submitPending}
            onClick={e => {
              e.preventDefault()
              props.close()
            }}
          >
            Close
          </button>
        </div>
      </>
    )
  }

  return (
    <>
      {props.children}
      <div style={{ gridArea: 'error', color: '#f00' }}>{props.submitError}</div>
      {props.formRunState === 'conflict' && (
        <ErrorBox>
          Cannot start this command because another command of the same type is already running. You can wait and try
          again once the running command finishes, or you can view the command run in progress.
        </ErrorBox>
      )}
      <div className='actions'>
        {props.formRunState === 'conflict' && (
          <button
            onClick={e => {
              e.preventDefault()
              props.watch()
            }}
          >
            View command in progress
          </button>
        )}
        <button
          disabled={props.submitPending}
          onClick={e => {
            e.preventDefault()
            props.close()
          }}
        >
          Cancel
        </button>
        <button disabled={props.submitPending} className='primary' type='submit'>
          Run Command
        </button>
      </div>
    </>
  )
}
