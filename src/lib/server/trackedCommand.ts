import 'server-only'

import { EventEmitter } from 'node:events'

import * as pty from 'node-pty'

import { type TrackedCommandExit } from '@/lib/util'

export interface TrackedCommandEvents {
  data: [data: string]
  exit: [exit: TrackedCommandExit]
}

export type TrackedCommandStatus =
  { status: 'done'; exit: TrackedCommandExit } | { status: 'running'; emitter: EventEmitter<TrackedCommandEvents> }

export type TrackedCommandState = TrackedCommandStatus & {
  started: Date
  lastEvent: Date
  output: string[]
}

const g = globalThis as typeof globalThis & { __trackedCommandState?: Map<string, TrackedCommandState> }
if (!g.__trackedCommandState) g.__trackedCommandState = new Map()
const trackedCommandState = g.__trackedCommandState

/**
 * A running tracked command contains an eventemitter for tracking future output from the command.
 * A completed tracked command retains the log and terminal error (if any).
 */
export function getTrackedCommandState(trackingKey: string): Readonly<TrackedCommandState> | undefined {
  return trackedCommandState.get(trackingKey)
}

/**
 * Starting a tracked command connects:
 *  - a child process that produces output
 *  - a key that allows the output to be streamed from /api/admin/tracked-command/[key]
 * There can only be one tracked command for a given key at a time;
 * startTrackedCommand will return null if the tracking key is associated with a running command.
 *
 * The output from completed tracked commands is retained until a new command with the same tracking key is started.
 */
export function startTrackedCommand(
  trackingKey: string,
  file: string,
  args: string[],
  options?: pty.IPtyForkOptions,
): EventEmitter<TrackedCommandEvents> | null {
  // Only one streaming command for a given key at a time
  if ((trackedCommandState.get(trackingKey)?.status ?? 'done') !== 'done') return null
  if (!trackingKey.match(/^[a-zA-Z0-9-]+$/)) throw new Error(`Tracking key ${trackingKey} not URL-safe`)

  const started = new Date()
  const output: string[] = [] // Single log for this job, imperatively updated
  const emitter = new EventEmitter<TrackedCommandEvents>()
  const ptyProcess = pty.spawn(file, args, { name: 'dumb', ...(options ?? {}) })
  trackedCommandState.set(trackingKey, { status: 'running', emitter, started, lastEvent: started, output })

  ptyProcess.onData(data => {
    output.push(data)
    trackedCommandState.set(trackingKey, { status: 'running', emitter, started, lastEvent: new Date(), output })
    emitter.emit('data', data)
  })
  ptyProcess.onExit(({ exitCode, signal }) => {
    let exit: TrackedCommandExit
    if (signal) {
      exit = { type: 'killed', signal }
    } else if (exitCode) {
      exit = { type: 'error', exitCode }
    } else {
      exit = { type: 'success' }
    }

    trackedCommandState.set(trackingKey, { status: 'done', started, lastEvent: new Date(), output, exit })
    emitter.emit('exit', exit)
  })

  return emitter
}
