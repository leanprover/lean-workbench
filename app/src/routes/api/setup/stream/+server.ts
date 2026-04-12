import { getSeedEvents, isSeedingInProgress } from '$lib/server/seedVolume'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = () => {
  let cursor = 0
  let intervalId: ReturnType<typeof setInterval>

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()
      intervalId = setInterval(() => {
        const events = getSeedEvents()
        while (cursor < events.length) {
          const event = events[cursor++]
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
          if (event.type === 'done' || event.type === 'error') {
            clearInterval(intervalId)
            controller.close()
            return
          }
        }
        if (!isSeedingInProgress() && cursor >= events.length) {
          clearInterval(intervalId)
          controller.close()
        }
      }, 500)
    },
    cancel() {
      clearInterval(intervalId)
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  })
}
