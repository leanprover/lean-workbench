'use client'

import '@/css/simpletty.css'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { type TrackedCommandEvent, type TrackedCommandExit, zTrackedCommandEvent } from '@/lib/util'

interface SimpleTTYProps {
  streamingCommandKey: string
  onExit?: (exit: TrackedCommandExit) => void
}

/*
 * This state representation only allows the simplest of terminal operations:
 * recognition of `\r` and `\n`, and a bit of special-cased functionality like
 * noticing `\x1b[2K\r` by walking backwards from `\r` and treating it as a
 * newline.
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
  return <SimpleTTYSession key={attempt} reload={() => setAttempt(attempt + 1)} {...props} />
}

type SimpleTTYState =
  | { type: 'loading'; buffer: never[] }
  | { type: 'no-stream'; buffer: never[] }
  | {
      type: 'running'
      buffer: string[]
      tail: string[]
      cursor: number /* 0 <= cursor <= tail.length */
    }
  | { type: 'disconnected'; buffer: string[] }
  | { type: 'done'; buffer: string[]; exit: TrackedCommandExit }

/**
 * Custom hook: establish and maintain a connection to the streaming command source for a given
 * key, and return a SimpleTTYState and bonus unexpectedError signal
 */
function useTerminalConnection(streamingCommandKey: string, onExit?: (exit: TrackedCommandExit) => void) {
  const [unexpectedError, setUnexpectedError] = useState(false)
  const incomingEventMessages = useRef<TrackedCommandEvent[]>([])
  const animationRequest = useRef<ReturnType<typeof requestAnimationFrame> | undefined>(undefined)
  const [state, setState] = useState<SimpleTTYState>({ type: 'loading', buffer: [] })

  // Hand-rolled useEffectEvent
  const handleExit = useRef<undefined | ((exit: TrackedCommandExit) => void)>(onExit)
  useEffect(() => {
    handleExit.current = onExit
  }, [onExit])

  const updater = useCallback(() => {
    animationRequest.current = undefined
    const messages = incomingEventMessages.current
    incomingEventMessages.current = []
    setState((oldState: SimpleTTYState) => {
      let termBuffer: string[], termTail: string[], termCursor: number
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
        return oldState
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

      const newline = () => {
        termBuffer = appendToBuffer(termTail.join(''))
        termTail = Array<string>(termCursor).fill(' ')
      }

      const finalize = (index: number) => {
        if (index !== messages.length - 1) {
          console.error(`SimpleTTY received more messages after the supposedly-final message`, messages.slice(index))
          setUnexpectedError(true)
        }
        return appendToBuffer(termTail.join(''))
      }

      for (const [index, message] of messages.entries()) {
        switch (message.type) {
          case 'no-stream':
            if (oldState.type === 'loading') {
              return { type: 'no-stream', buffer: oldState.buffer }
            } else {
              console.error(`no-stream received after another message`)
              setUnexpectedError(true)
            }
            break
          case 'exit':
            return { type: 'done', buffer: finalize(index), exit: message.exit }
          case 'data': {
            for (const ch of message.data) {
              if (ch === '\n') {
                newline()
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
      return { type: 'running', buffer: termBuffer, tail: termTail, cursor: termCursor }
    })

    // Trigger exit handler when the last message is an exit
    const lastMessage = messages[messages.length - 1]
    if (lastMessage?.type === 'exit') handleExit.current?.(lastMessage.exit)
  }, [])

  useEffect(() => {
    const source = new EventSource(`/api/admin/tracked-command/${streamingCommandKey}`)
    source.onmessage = event => {
      if (animationRequest.current === undefined) {
        animationRequest.current = requestAnimationFrame(updater)
      }

      try {
        const data = zTrackedCommandEvent.parse(
          JSON.parse(event.data as string /* EventSources ensure this in practice */),
        )
        incomingEventMessages.current.push(data)
        if (data.type !== 'data') source.close()
      } catch (err) {
        source.close()
        console.error(`SimpleTTY got an unexpected server response`, err)
        setUnexpectedError(true)
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
      setState(state => {
        let buffer = state.buffer
        if (state.type === 'running') buffer = [...buffer, state.tail.join('')]
        return { type: 'disconnected', buffer }
      })
      source.close()
    }
    return () => {
      if (animationRequest.current !== undefined) cancelAnimationFrame(animationRequest.current)
      animationRequest.current = undefined
      source.close()

      // Resetting the state *should* only matters for HMR, when the effect gets rerun
      incomingEventMessages.current = []
      setState({ type: 'loading', buffer: [] })
    }
  }, [streamingCommandKey, updater])

  return { state, unexpectedError }
}

function SimpleTTYSession({ streamingCommandKey, reload, onExit }: SimpleTTYProps & { reload: () => void }) {
  const divRef = useRef<HTMLDivElement>(null)
  const { state, unexpectedError } = useTerminalConnection(streamingCommandKey, onExit)
  const backscroll = useMemo(() => state.buffer.join('\n'), [state.buffer])

  // Auto-scroller for terminal
  useLayoutEffect(() => {
    const el = divRef.current
    if (el) el.scrollTop = el.scrollHeight
  })

  const className = unexpectedError
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
      {(state.type === 'loading' || state.type === 'running') && (
        <div>
          <span className='setup-spinner' /> Command in progress&hellip;
        </div>
      )}
      {state.type === 'done' && state.exit.type === 'success' && <div>✅ Command finished successfully</div>}
      {state.type === 'done' && state.exit.type === 'killed' && (
        <div>❌ Command killed by signal {state.exit.signal}</div>
      )}
      {state.type === 'done' && state.exit.type === 'error' && (
        <div>❌ Command exited with non-zero exit code {state.exit.exitCode}</div>
      )}
      {state.type === 'disconnected' && <div>⛓️‍💥 Terminal log disconnected</div>}
      {unexpectedError && <div>There was an unexpected error! See log for details.</div>}
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
          <button
            onClick={e => {
              e.preventDefault()
              reload()
            }}
          >
            Reconnect
          </button>
        </div>
      )}
    </div>
  )
}
