// In sandboxed development, changes in a text editor running outside the sandbox
// will not always be correctly reflected inside the sandbox.
// This script polls and nudges modified files as a workaround for this issue.
// (See DEVELOPMENT.md)

import { createHash } from 'node:crypto'
import { readFile, utimes } from 'node:fs/promises'

import chokidar from 'chokidar'

const paths = process.argv.length < 3 ? ['src'] : process.argv.slice(2)
const hashes = new Map()
const nudge = async file => {
  const hash = createHash('sha256')
    .update(await readFile(file))
    .digest('hex')
  if (hashes.get(file) === hash) return
  hashes.set(file, hash)
  const now = new Date()
  await utimes(file, now, now)
  console.log(`[hmr-nudge] ${file}`)
}

chokidar
  .watch(paths, {
    usePolling: true,
    interval: 400,
    ignoreInitial: true,
    ignored: /node_modules|lean-workbench-data|(^|\/)\./,
  })
  .on('all', (event, file) => {
    if (event === 'unlink' || event === 'unlinkDir' || event === 'addDir') return
    nudge(file).catch(err => console.error(`[hmr-nudge] ${file}: ${err.message}`))
  })
