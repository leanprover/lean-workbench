import 'server-only'

import { type TrackedCommandEvent, type TrackedCommandExit } from '@/lib/util'

import { type TrackedCommandState } from './trackedCommand'

export const TRACKED_COMMAND_STREAMING_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
} as const

/**
 * Server-sent events carrying a tracked command's output:
 * the output so far, then the rest of it as it happens.
 * An absent {@link state} is reported as `no-stream`,
 * which is also how a route denies access to a command the requester may not watch.
 */
export function trackedCommandEventStream(request: Request, state: Readonly<TrackedCommandState> | undefined) {
  const encoder = new TextEncoder()

  return new Response(
    new ReadableStream({
      start(controller) {
        const send = (msg: TrackedCommandEvent) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(msg)}\n\n`))
        }

        if (!state) {
          send({ type: 'no-stream' })
          controller.close()
          return
        }

        // Replay previous progress
        for (const data of state.output) send({ type: 'data', data })

        // Option 1 of 2: synchronously exit
        if (state.status === 'done') {
          send({ type: 'exit', exit: state.exit })
          controller.close()
          return
        }

        // Option 2 of 2: stream the rest of the output as it happens
        const emitter = state.emitter

        // nginx will close connections that don't send some message in 60s
        const keepAliveInterval = setInterval(() => {
          controller.enqueue(encoder.encode(':\n'))
        }, 10_000)

        const onData = (data: string) => {
          send({ type: 'data', data })
        }
        emitter.on('data', onData)

        const onExit = (exit: TrackedCommandExit) => {
          send({ type: 'exit', exit })
          cleanup()
        }
        emitter.on('exit', onExit)

        const cleanup = () => {
          clearInterval(keepAliveInterval)
          emitter.off('data', onData)
          emitter.off('exit', onExit)
          request.signal.removeEventListener('abort', cleanup) // avoids double-calling cleanup
          controller.close()
        }
        request.signal.addEventListener('abort', cleanup, { once: true })
        if (request.signal.aborted) cleanup() // oops, the connection was closed when the function started
      },
    }),
    { headers: TRACKED_COMMAND_STREAMING_HEADERS },
  )
}
