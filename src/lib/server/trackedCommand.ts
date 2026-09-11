import 'server-only'

import { EventEmitter } from 'node:events'

import * as pty from 'node-pty'

import { type TrackedCommandExit } from '@/lib/util'

import { type User } from './auth'

export interface TrackedCommandEvents {
  data: [data: string]
  exit: [exit: TrackedCommandExit]
}

export type TrackedCommandStatus =
  { status: 'done'; exit: TrackedCommandExit } | { status: 'running'; emitter: EventEmitter<TrackedCommandEvents> }

/** Who is allowed to watch a tracked command's output,
 * and so which map the command is tracked in.
 * Plain data rather than a closure, so that it survives HMR along with the rest of the state. */
export type TrackedCommandOwner = { kind: 'admin' } | { kind: 'user'; userId: string }

export type TrackedCommandState = TrackedCommandStatus & {
  owner: TrackedCommandOwner
  started: Date
  lastEvent: Date
  output: string[]
}

/** Administrative commands share a single key space, so only one can run under a given key at a time.
 * Each user gets their own key space, so users never contend with each other or with an administrator. */
const g = globalThis as typeof globalThis & {
  __trackedCommandState?: {
    adminTrackedCommandState: Map<string, TrackedCommandState>
    userTrackedCommandState: Map<string, Map<string, TrackedCommandState>>
  }
}
if (!g.__trackedCommandState)
  g.__trackedCommandState = { adminTrackedCommandState: new Map(), userTrackedCommandState: new Map() }
const { adminTrackedCommandState, userTrackedCommandState } = g.__trackedCommandState

function ownerTrackedCommandState(owner: TrackedCommandOwner): Map<string, TrackedCommandState> {
  if (owner.kind === 'admin') return adminTrackedCommandState
  let state = userTrackedCommandState.get(owner.userId)
  if (!state) {
    state = new Map()
    userTrackedCommandState.set(owner.userId, state)
  }
  return state
}

/**
 * A running tracked command contains an eventemitter for tracking future output from the command.
 * A completed tracked command retains the log and terminal error (if any).
 *
 * This reads the administrative commands, so it is for administrative callers;
 * anything reachable by an ordinary user goes through {@link getUserTrackedCommandState}.
 */
export function getTrackedCommandState(trackingKey: string): Readonly<TrackedCommandState> | undefined {
  return adminTrackedCommandState.get(trackingKey)
}

/** The tracked command with this key among {@link user}'s own commands.
 * A command owned by anybody else, or by no user at all, is reported as absent. */
export function getUserTrackedCommandState(user: User, trackingKey: string): Readonly<TrackedCommandState> | undefined {
  return userTrackedCommandState.get(user.id)?.get(trackingKey)
}

/** How many running tracked commands, across every owner, have a key accepted by {@link match}.
 * Used to bound how many builds of one sort may run at once. */
export function countRunningTrackedCommands(match: (trackingKey: string) => boolean): number {
  let count = 0
  for (const commands of [adminTrackedCommandState, ...userTrackedCommandState.values()]) {
    for (const [key, state] of commands) {
      if (state.status === 'running' && match(key)) count++
    }
  }
  return count
}

/**
 * Starting a tracked command connects:
 *  - a child process that produces output
 *  - a key that allows the output to be streamed to {@link owner}:
 *    admin-owned commands from /api/admin/tracked-command/[key],
 *    user-owned commands from /api/tracked-command/[key]
 * There can only be one tracked command for a given key at a time;
 * startTrackedCommand will return null if the tracking key is associated with a running command.
 *
 * The output from completed tracked commands is retained until a new command with the same tracking key is started.
 */
export function startTrackedCommand(
  trackingKey: string,
  owner: TrackedCommandOwner,
  file: string,
  args: string[],
  options?: pty.IPtyForkOptions,
): EventEmitter<TrackedCommandEvents> | null {
  const ownerState = ownerTrackedCommandState(owner)

  // Only one streaming command for a given key at a time
  if ((ownerState.get(trackingKey)?.status ?? 'done') !== 'done') return null
  if (!trackingKey.match(/^[a-zA-Z0-9-]+$/)) throw new Error(`Tracking key ${trackingKey} not URL-safe`)

  const started = new Date()
  const output: string[] = [] // Single log for this job, imperatively updated
  const emitter = new EventEmitter<TrackedCommandEvents>()
  const ptyProcess = pty.spawn(file, args, { name: 'dumb', ...(options ?? {}) })
  ownerState.set(trackingKey, { status: 'running', owner, emitter, started, lastEvent: started, output })

  ptyProcess.onData(data => {
    output.push(data)
    ownerState.set(trackingKey, { status: 'running', owner, emitter, started, lastEvent: new Date(), output })
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

    ownerState.set(trackingKey, { status: 'done', owner, started, lastEvent: new Date(), output, exit })
    emitter.emit('exit', exit)
  })

  return emitter
}
