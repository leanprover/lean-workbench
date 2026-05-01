import { Server } from '@hocuspocus/server'

// -- CLI --
const socketPath = process.argv[2]
if (!socketPath) {
  console.error('Usage: node server.ts <socketPath>')
  process.exit(1)
}

// -- HTTPS/WS SERVER --
const server = new Server({})

const signalHandler = async () => {
  await server.destroy()
  process.exit(0)
}
process.on('SIGINT', signalHandler)
process.on('SIGQUIT', signalHandler)
process.on('SIGTERM', signalHandler)

// `Server.listen` requires a port. We use a socket instead.
server.httpServer.listen(socketPath, () => {
  // Cosmetic monkey-patches to display the correct start screen. Server works without these, too.
  Object.defineProperty(server, 'webSocketURL', {
    get: () => `ws+unix://${socketPath}`,
  })
  Object.defineProperty(server, 'httpURL', {
    get: () => `http+unix://${socketPath}`,
  })
  server['showStartScreen']()

  // No need to call HP's `onListen` hooks here since we don't register any.
})

// -- YJS FILE MANAGEMENT: TODO --
