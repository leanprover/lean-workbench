import './dumbtty.css'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { type StreamedLogEvent, zStreamedLogEvent } from '@/lib/util'

interface DumbTTYProps {
  streamingCommandKey: string
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

type DumbTTYState =
  | { type: 'loading'; buffer: never[] }
  | { type: 'running'; buffer: string[]; tail: string[]; cursor: number /* 0 <= cursor <= tail.length */ }
  | { type: 'done'; buffer: string[] }
  | { type: 'error'; buffer: string[]; error: string }

/**
 * SimpleTTY is a wrapping presentation of an infinitely-wide terminal with
 * minimal support for control sequences. It cooperates with the "streaming
 * commands" infrastructure that stores terminal output and sends it to users
 * with Server-Sent Events.
 */
export default function DumbTTY(props: DumbTTYProps) {
  const [attempt, setAttempt] = useState(0)
  return <DumbTTYSession key={attempt} reload={() => setAttempt(attempt + 1)} {...props} />
}

function DumbTTYSession({ streamingCommandKey, reload }: DumbTTYProps & { reload: () => void }) {
  const incomingEventMessages = useRef<StreamedLogEvent[]>([])
  const animationRequest = useRef<ReturnType<typeof requestAnimationFrame> | undefined>(undefined)
  const [state, setState] = useState<DumbTTYState>({ type: 'loading', buffer: [] })
  const [unexpectedError, setUnexpectedError] = useState(false)
  const [disconnected, setDisconnected] = useState(false)
  const divRef = useRef<HTMLDivElement>(null)

  const updater = useCallback(() => {
    animationRequest.current = undefined
    const messages = incomingEventMessages.current
    incomingEventMessages.current = []
    setState((oldState: DumbTTYState) => {
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
        console.error('DumbTTY animation frame called while in a finished state', messages.slice(0))
        setUnexpectedError(true)
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
          console.error(`DumbTTY received more messages after the supposedly-final message`, messages.slice(index))
          setUnexpectedError(true)
        }
        return appendToBuffer(termTail.join(''))
      }

      for (const [index, message] of messages.entries()) {
        switch (message.type) {
          case 'done':
            return { type: 'done', buffer: finalize(index) }
          case 'error':
            return { type: 'error', buffer: finalize(index), error: message.message }
          case 'log': {
            const line = [...message.line]
            for (const [col, ch] of line.entries()) {
              if (ch === '\n') {
                newline()
              } else if (ch === '\r') {
                // Heuristic check for `['\x1b', '[', '2', 'K', '\r']` sequence ("blank out the line")
                if (col > 4 && line.slice(col - 4, col).join('') === '\x1b[2K') {
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
  }, [])

  useEffect(() => {
    const source = new EventSource(`/api/admin/stream/${streamingCommandKey}`)
    source.onmessage = event => {
      if (animationRequest.current === undefined) {
        animationRequest.current = requestAnimationFrame(updater)
      }

      try {
        const data = zStreamedLogEvent.parse(
          JSON.parse(event.data as string /* EventSources ensure this in practice */),
        )
        incomingEventMessages.current.push(data)
        if (data.type === 'error' || data.type === 'done') source.close()
      } catch (err) {
        source.close()
        console.error(`DumbTTY got an unexpected server response`, err)
        setUnexpectedError(true)
      }
    }
    source.onerror = event => {
      console.log(`Unexpected error from DumbTTY's eventsource`, event)
      setDisconnected(true)
      source.close()
    }
    return () => {
      if (animationRequest.current !== undefined) cancelAnimationFrame(animationRequest.current)
      animationRequest.current = undefined
      source.close()
    }
  }, [streamingCommandKey, updater])

  // Auto-scroller for terminal
  useLayoutEffect(() => {
    const el = divRef.current
    if (el) el.scrollTop = el.scrollHeight
  })

  const backscroll = useMemo(() => state.buffer.join('\n'), [state.buffer])

  const className =
    unexpectedError || state.type === 'error'
      ? ' tty-error'
      : disconnected || state.type === 'loading'
        ? ' tty-loading'
        : state.type === 'done'
          ? ' tty-success'
          : ''

  return (
    <div className={`tty${className}`}>
      {state.type === 'loading' ||
        (state.type === 'running' && (
          <div>
            <span className='setup-spinner' /> Command in progress&hellip;
          </div>
        ))}
      {state.type === 'done' && <div>✅ Command finished successfully</div>}
      {state.type === 'error' && <div>❌ Command failed: {state.error}</div>}
      {unexpectedError && <div>There was an unexpected error! See log for details.</div>}
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
          {backscroll}
          {state.type === 'running' && '\n' + state.tail.join('')}
        </pre>
      </div>
      {disconnected && (
        <div className='followup'>
          <div>Session was disconnected</div>
          <button
            onClick={e => {
              e.preventDefault()
              reload()
            }}
          >
            Reload Session
          </button>
        </div>
      )}
    </div>
  )
}
