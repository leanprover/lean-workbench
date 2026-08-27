import 'server-only'

import { type EventEmitter } from 'node:stream'

export interface CommandEvents {
  done: []
  error: [message: string]
  log: [line: string]
}

export type StreamingCommandStatus =
  { status: 'done'; error: string | null } | { status: 'running'; emitter: EventEmitter<CommandEvents> }

export type StreamingCommandState = StreamingCommandStatus & {
  started: Date
  lastEvent: Date
  log: string[]
}

const g = globalThis as typeof globalThis & { __streamingCommandState?: Map<string, StreamingCommandState> }
if (!g.__streamingCommandState) g.__streamingCommandState = new Map()
const streamingCommandState = g.__streamingCommandState

/**
 * A running streaming command contains an eventemitter for streaming future command events.
 * A completed streaming command retains the log and terminal error (if any).
 */
export function getStreamingCommandState(key: string): Readonly<StreamingCommandState> | undefined {
  return streamingCommandState.get(key)
}

/**
 * Starting a streaming command connects:
 *  - an EventEmitter that is capturing the console output from child process
 *  - a key that allows the output to be streamed from /api/admin/stream/[key]
 * There can only be one task for a given key at a time.
 *
 * The start() function returns an EventEmitter that emits log messages.
 * A `done` or `error` message MUST NOT be followed by another `log` message.
 */
export function startStreamingCommand(key: string, start: () => EventEmitter<CommandEvents>) {
  // Only one streaming command for a given key at a time
  if ((streamingCommandState.get(key)?.status ?? 'done') !== 'done') return null

  const emitter = start()
  const started = new Date()
  const log: string[] = [] // Single log for this job, imperatively updated
  streamingCommandState.set(key, { status: 'running', started, lastEvent: started, log, emitter })

  emitter.on('log', line => {
    log.push(line)
    streamingCommandState.set(key, { status: 'running', emitter, started, lastEvent: new Date(), log })
  })

  emitter.on('done', () => {
    streamingCommandState.set(key, { status: 'done', error: null, started, lastEvent: new Date(), log })
  })

  emitter.on('error', error => {
    streamingCommandState.set(key, { status: 'done', error, started, lastEvent: new Date(), log })
  })

  return emitter
}
