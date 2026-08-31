import { requireAdmin } from '@/lib/server/auth'
import { getTrackedCommandState } from '@/lib/server/trackedCommand'
import { type TrackedCommandEvent, type TrackedCommandExit } from '@/lib/util'

/**
 * Return server-sent events for a streaming command
 */
export async function GET(request: Request, context: RouteContext<'/api/admin/tracked-command/[key]'>) {
  await requireAdmin()
  const { key } = await context.params
  const encoder = new TextEncoder()

  return new Response(
    new ReadableStream({
      start(controller) {
        const send = (msg: TrackedCommandEvent) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(msg)}\n\n`))
        }

        const state = getTrackedCommandState(key)
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
        const keepAliveTimeout = setInterval(() => {
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
          clearInterval(keepAliveTimeout)
          emitter.off('data', onData)
          emitter.off('exit', onExit)
          request.signal.removeEventListener('abort', cleanup) // avoids double-calling cleanup
          controller.close()
        }
        request.signal.addEventListener('abort', cleanup, { once: true })
        if (request.signal.aborted) cleanup() // oops, the connection was closed when the function started
      },
    }),
    {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    },
  )
}
