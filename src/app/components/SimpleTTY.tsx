'use client'

import '@/css/simpletty.css'

import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { type TrackedCommandEvent, type TrackedCommandExit, zTrackedCommandEvent } from '@/lib/util'

interface SimpleTTYProps {
  streamingCommandKey: string
  onExit?: (exit: TrackedCommandExit) => void
}

/*
 * This state representation only allows the simplest of terminal operations:
 * recognition of `\r` and `\n`, and a bit of special-cased functionality like
 * noticing `\x1b[2K` at the end of a line when we see a newline.
 *
 * If we want to recognize other control sequences, we need to deal with the
 * fact that any byte sequence can get interrupted, and maintain the
 * resumption state in the `running` state. That probably means understanding
 * https://vt100.net/emu/dec_ansi_parser, unfortunately.
 */

/**
 * SimpleTTY is a representation of terminal output, with minimal support for
 * control sequences. It cooperates with the "streaming commands"
 * infrastructure that stores terminal output and sends it to users with
 * Server-Sent Events.
 *
 * The auto-reconnection features of SSE are disabled; instead, an explicit
 * user action is needed to reconnect.
 */
export default function SimpleTTY(props: SimpleTTYProps) {
  const [attempt, setAttempt] = useState(0)
  return <SimpleTTYSession key={attempt} reload={() => setAttempt(attempt => attempt + 1)} {...props} />
}

type Progress = null | { currentStep: number; numSteps: number; name: string }
type SimpleTTYState = (
  | { type: 'loading'; buffer: never[]; progress: null }
  | { type: 'no-stream'; buffer: never[]; progress: null }
  | { type: 'running'; tail: string[]; cursor: number /* 0 <= cursor <= tail.length */ }
  | { type: 'disconnected' }
  | { type: 'done'; buffer: string[]; exit: TrackedCommandExit }
) & { buffer: string[]; unexpectedError: boolean; progress: Progress }

/**
 * Custom hook: establish and maintain a connection to the streaming command source for a given
 * key, and return a SimpleTTYState and bonus unexpectedError signal
 */
function useTerminalConnection(streamingCommandKey: string, onExit?: (exit: TrackedCommandExit) => void) {
  const incomingEventMessages = useRef<TrackedCommandEvent[]>([])
  const animationRequest = useRef<ReturnType<typeof requestAnimationFrame> | undefined>(undefined)
  const [state, setState] = useState<SimpleTTYState>({
    type: 'loading',
    buffer: [],
    unexpectedError: false,
    progress: null,
  })

  // Hand-rolled useEffectEvent
  const handleExit = useRef<undefined | ((exit: TrackedCommandExit) => void)>(onExit)
  useEffect(() => {
    handleExit.current = onExit
  }, [onExit])

  const updater = useCallback(() => {
    animationRequest.current = undefined
    const messages = incomingEventMessages.current
    incomingEventMessages.current = []
    setState((oldState: SimpleTTYState): SimpleTTYState => {
      let unexpectedError = oldState.unexpectedError
      let termBuffer: string[], termTail: string[], termCursor: number
      let termProgress: Progress = oldState.progress
      if (oldState.type === 'running') {
        termBuffer = oldState.buffer
        termTail = [...oldState.tail]
        termCursor = oldState.cursor
      } else if (oldState.type === 'loading') {
        termBuffer = []
        termTail = []
        termCursor = 0
      } else {
        console.error('SimpleTTY animation frame called while in a finished state', oldState, messages.slice(0))
        return { ...oldState, unexpectedError: true }
      }

      /* Perform copy-on-write to make memoization better */
      const appendToBuffer = (str: string) => {
        if (oldState.type === 'running' && termBuffer === oldState.buffer) {
          return [...oldState.buffer, str]
        } else {
          termBuffer.push(str)
          return termBuffer
        }
      }

      const finalize = (index: number) => {
        if (index !== messages.length - 1) {
          console.error(`SimpleTTY received more messages after the supposedly-final message`, messages.slice(index))
          unexpectedError = true
        }
        return appendToBuffer(termTail.join(''))
      }

      for (const [index, message] of messages.entries()) {
        switch (message.type) {
          case 'no-stream':
            if (oldState.type === 'loading') {
              return { type: 'no-stream', buffer: oldState.buffer, unexpectedError, progress: oldState.progress }
            } else {
              console.error(`no-stream received after another message`)
              unexpectedError = true
            }
            break
          case 'exit': {
            const buffer = finalize(index)
            return { type: 'done', buffer, exit: message.exit, unexpectedError, progress: termProgress }
          }
          case 'data': {
            for (const ch of message.data) {
              if (ch === '\n') {
                const newTail = termTail.join('')
                const progressMatch = newTail.match(/^\[\[ progress ([0-9]+)\/([0-9]+) (.*) \]\]$/)
                if (progressMatch) {
                  const [_all, currentStep, numSteps, name] = progressMatch
                  termProgress = { currentStep: Number(currentStep), numSteps: Number(numSteps), name: name! }
                } else {
                  termBuffer = appendToBuffer(newTail)
                }
                termTail = Array<string>(termCursor).fill(' ')
              } else if (ch === '\r') {
                // Heuristic check for `['\x1b', '[', '2', 'K', '\r']` sequence ("blank out the line")
                if (termCursor >= 4 && termTail.slice(termCursor - 4, termCursor).join('') === '\x1b[2K') {
                  termTail = []
                }
                termCursor = 0
              } else {
                termTail[termCursor++] = ch
              }
            }
          }
        }
      }
      return {
        type: 'running',
        buffer: termBuffer,
        tail: termTail,
        cursor: termCursor,
        unexpectedError,
        progress: termProgress,
      }
    })

    // Trigger exit handler when the last message is an exit
    const lastMessage = messages[messages.length - 1]
    if (lastMessage?.type === 'exit') handleExit.current?.(lastMessage.exit)
  }, [])

  useEffect(() => {
    const source = new EventSource(`/api/admin/tracked-command/${streamingCommandKey}`)
    source.onmessage = event => {
      try {
        const data = zTrackedCommandEvent.parse(
          JSON.parse(event.data as string /* EventSources ensure this in practice */),
        )
        incomingEventMessages.current.push(data)
        if (animationRequest.current === undefined) {
          animationRequest.current = requestAnimationFrame(updater)
        }
        if (data.type !== 'data') source.close()
      } catch (err) {
        source.close()
        console.error(`SimpleTTY got an unexpected server response`, err)
        setState(state => ({ ...state, unexpectedError: true }))
      }
    }
    source.onerror = event => {
      if (source.readyState === EventSource.CONNECTING) {
        console.error('Connection to eventsource was interrupted', event)
      } else if (source.readyState === EventSource.CLOSED) {
        console.error('EventSource closed unexpectedly', event)
      } else {
        console.error('Unexpected EventSource error while in the OPEN state', event)
      }
      if (animationRequest.current !== undefined) {
        cancelAnimationFrame(animationRequest.current)
        updater() // Clear out any messages that were received before the error
      }
      setState(oldState => {
        let buffer = oldState.buffer
        if (oldState.type === 'running') buffer = [...oldState.buffer, oldState.tail.join('')]
        return { type: 'disconnected', buffer, unexpectedError: oldState.unexpectedError, progress: oldState.progress }
      })
      source.close()
    }
    return () => {
      if (animationRequest.current !== undefined) cancelAnimationFrame(animationRequest.current)
      animationRequest.current = undefined
      source.close()

      // Resetting the state *should* only matters for HMR, when the effect gets rerun
      incomingEventMessages.current = []
      setState({ type: 'loading', buffer: [], unexpectedError: false, progress: null })
    }
  }, [streamingCommandKey, updater])

  return state
}

function SimpleTTYSession({ streamingCommandKey, reload, onExit }: SimpleTTYProps & { reload: () => void }) {
  const divRef = useRef<HTMLDivElement>(null)
  const state = useTerminalConnection(streamingCommandKey, onExit)
  const backscroll = useMemo(() => state.buffer.join('\n'), [state.buffer])

  // Auto-scroller for terminal
  useLayoutEffect(() => {
    const el = divRef.current
    if (el) el.scrollTop = el.scrollHeight
  })

  const className = state.unexpectedError
    ? ' tty-error'
    : state.type === 'loading' || state.type === 'disconnected'
      ? ' tty-loading'
      : state.type !== 'done'
        ? ''
        : state.exit.type === 'success'
          ? ' tty-success'
          : ' tty-error'

  return (
    <div className={`tty${className}`}>
      <TTYStatusMessage state={state} />
      {state.unexpectedError && <div>There was an unexpected error! See log for details.</div>}
      {
        <div ref={divRef} style={{ maxHeight: '200px', overflowY: 'scroll' }}>
          <pre
            style={{
              backgroundColor: '#1a1a2e',
              color: 'oklch(0.85 0.08 150)',
              padding: '0.375rem',
              textWrap: 'wrap',
              wordBreak: 'break-all',
            }}
          >
            {state.type === 'loading' && 'Waiting for process to respond...'}
            {state.type === 'no-stream' && `Cannot connect: there is no process "${streamingCommandKey}"`}
            {backscroll}
            {state.type === 'running' && '\n' + state.tail.join('')}
          </pre>
        </div>
      }
      {state.type === 'disconnected' && (
        <div className='followup'>
          <button type='button' onClick={reload}>
            Reconnect
          </button>
        </div>
      )}
    </div>
  )
}

function TTYStatusMessage({ state }: { state: SimpleTTYState }) {
  let icon: ReactNode
  switch (state.type) {
    case 'loading':
    case 'running':
      icon = <span className='command-spinner' />
      break
    case 'no-stream':
    case 'disconnected':
      icon = '⛓️‍💥'
      break
    case 'done':
      icon = state.exit.type === 'success' ? '✅' : '❌'
  }

  const failureMessage =
    state.type === 'done' && state.exit.type !== 'success'
      ? state.exit.type === 'killed'
        ? `Command killed by signal ${state.exit.signal}`
        : `Command exited with non-zero exit code ${state.exit.exitCode}`
      : null

  let message: string
  if (state.progress) {
    const progressMessage = `Step ${state.progress.currentStep} of ${state.progress.numSteps}: ${state.progress.name}`
    switch (state.type) {
      case 'running':
        message = progressMessage
        break
      case 'disconnected':
        message = `${progressMessage} (Disconnected)`
        break
      case 'done':
        message = failureMessage ? `${progressMessage} (${failureMessage})` : 'Command finished successfully'
        break
    }
  } else {
    switch (state.type) {
      case 'loading':
      case 'running':
        message = `Command in progress…`
        break
      case 'no-stream':
        message = `Terminal could not connect`
        break
      case 'disconnected':
        message = `Terminal log disconnected`
        break
      case 'done':
        message = failureMessage ?? 'Command finished successfully'
        break
    }
  }

  let progressAmount = state.progress
    ? Math.min(Math.max(0, state.progress.currentStep - 0.5), state.progress.numSteps)
    : 0
  let progressBar: ReactNode = null
  if (state.progress) {
    if (state.type === 'done' && state.exit.type === 'success') progressAmount = state.progress.numSteps
    progressBar = (
      <div
        className='command-progress-outer'
        role='progressbar'
        aria-valuemin={0}
        aria-valuemax={state.progress.numSteps}
        aria-valuenow={progressAmount}
        style={{
          gridTemplateColumns: `${progressAmount}fr ${state.progress.numSteps - progressAmount}fr`,
        }}
      >
        <div className='command-progress-inner' />
        <div />
      </div>
    )
  }

  return (
    <>
      <div className='command-progress-label'>
        {icon}
        <span>{message}</span>
      </div>
      {progressBar}
    </>
  )
}
