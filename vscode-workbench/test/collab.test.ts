import { HocuspocusProviderWebsocket } from '@hocuspocus/provider'
import { Server } from '@hocuspocus/server'
import * as assert from 'assert'
import * as vs from 'vscode'

import { YTextBinding } from '../src/textBinding'
import { type Logger } from '../src/util'

const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

const logLevel = vs.LogLevel.Debug as vs.LogLevel // cast prevents TS from complaining
const consoleLog: Logger = {
  logLevel,
  trace: (m, ...a) => {
    if (logLevel !== vs.LogLevel.Off && logLevel <= vs.LogLevel.Trace) console.log('[trace]', m, ...a)
  },
  debug: (m, ...a) => {
    if (logLevel !== vs.LogLevel.Off && logLevel <= vs.LogLevel.Debug) console.log('[debug]', m, ...a)
  },
  info: (m, ...a) => {
    if (logLevel !== vs.LogLevel.Off && logLevel <= vs.LogLevel.Info) console.log('[info]', m, ...a)
  },
  warn: (m, ...a) => {
    if (logLevel !== vs.LogLevel.Off && logLevel <= vs.LogLevel.Warning) console.warn('[warn]', m, ...a)
  },
  error: (m, ...a) => {
    if (logLevel !== vs.LogLevel.Off && logLevel <= vs.LogLevel.Error) console.error('[error]', String(m), ...a)
  },
}

/** Small seeded PRNG (mulberry32) for reproducibility. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const ALPHABET = 'abcdef \n'
function randomText(rng: () => number, len: number): string {
  let s = ''
  for (let i = 0; i < len; i++) s += ALPHABET[Math.floor(rng() * ALPHABET.length)]
  return s
}

/** Activate `doc` in `column`, then apply one random insert or delete
 * by executing the `default:type` / `deleteLeft` commands on its editor. */
async function randomEditOn(doc: vs.TextDocument, column: vs.ViewColumn, rng: () => number): Promise<void> {
  const editor = await vs.window.showTextDocument(doc, { viewColumn: column, preserveFocus: false, preview: false })
  const len = doc.getText().length
  const insert = len === 0 || rng() < 0.6
  if (insert) {
    const at = Math.floor(rng() * (len + 1))
    editor.selection = new vs.Selection(doc.positionAt(at), doc.positionAt(at))
    const text = randomText(rng, 1 + Math.floor(rng() * 6))
    try {
      await vs.commands.executeCommand('default:type', { text })
    } catch (e) {
      console.error('error on type', e)
    }
  } else {
    const at = Math.floor(rng() * len)
    const dl = 1 + Math.floor(rng() * Math.min(5, len - at))
    editor.selection = new vs.Selection(doc.positionAt(at), doc.positionAt(at + dl))
    try {
      await vs.commands.executeCommand('deleteLeft')
    } catch (e) {
      console.error('error on deleteLeft', e)
    }
  }
}

/** Poll until the given {@link YTextBinding}s receive their remote docs. */
async function waitForInitialSync(bindings: YTextBinding[], timeoutMs: number): Promise<void> {
  const deadline = performance.now() + timeoutMs
  while (!bindings.every(b => b.initialSyncDone)) {
    if (performance.now() >= deadline) {
      assert.fail('timed out waiting for initial sync')
    }
    await delay(50)
  }
}

/** Poll until the given {@link YTextBinding}s have remained unchanged for 1s. */
async function waitForQuiescence(bindings: YTextBinding[], timeoutMs: number): Promise<void> {
  const deadline = performance.now() + timeoutMs
  let prev = ''
  let stableIters = 0
  while (performance.now() < deadline) {
    const snap = bindings.map(b => b.remoteYtext.toString() + '|' + b.doc.getText()).join('|')
    if (snap === prev) {
      if (stableIters++ >= 5) return
    } else {
      prev = snap
      stableIters = 0
    }
    await delay(100)
  }
  assert.fail('timed out waiting for quiescent state')
}

function diffMessage(label: string, a: string, b: string): string {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  const ctx = (s: string) => JSON.stringify(s.slice(Math.max(0, i - 25), i + 25))
  return `${label}: diverge at index ${i} (lenA=${a.length}, lenB=${b.length})\n  A …${ctx(a)}…\n  B …${ctx(b)}…`
}

const DOC_NAME = '/test/shared.txt'
const COLUMNS: vs.ViewColumn[] = [vs.ViewColumn.One, vs.ViewColumn.Two]

suite('Collaborative editing', () => {
  interface TestHandles {
    docs: vs.TextDocument[]
    bindings: YTextBinding[]
    dispose: () => Promise<void>
  }

  const mkHandles = async (ensureSyncTimeoutMs: number = 0): Promise<TestHandles> => {
    // In-memory Hocuspocus server on an ephemeral port; no persistence, no signal handlers.
    const server = new Server({ stopOnSignals: false, quiet: true })
    await new Promise<void>(resolve => server.httpServer.listen(0, '127.0.0.1', resolve))
    const url = `ws://127.0.0.1:${server.address.port}`

    const mkClient = () => new HocuspocusProviderWebsocket({ url })
    const clients = [mkClient(), mkClient()]
    const docs = await Promise.all([
      vs.workspace.openTextDocument({ content: '', language: 'plaintext' }),
      vs.workspace.openTextDocument({ content: '', language: 'plaintext' }),
    ])
    const bindings = docs.map(
      (doc, i) => new YTextBinding(doc, clients[i]!, consoleLog, true, ensureSyncTimeoutMs, DOC_NAME),
    )

    // Route document changes to the matching binding
    // (`YTextBindingManager.onDidChangeTextDocument` does this in production).
    const changeSub = vs.workspace.onDidChangeTextDocument(e => {
      const i = docs.indexOf(e.document)
      if (i >= 0) bindings[i]!.onLocalChange(e)
    })

    return {
      docs,
      bindings,
      dispose: async () => {
        changeSub.dispose()
        for (const b of bindings) b.dispose()
        // Not disposing old docs to avoid 'did you mean to close unsaved buffer' warnings.
        for (const c of clients) c.destroy()
        await server.destroy()
      },
    }
  }

  test('YTextBindings reach initial sync', async function () {
    const handles = await mkHandles()
    await waitForInitialSync(handles.bindings, 1_000)
    await handles.dispose()
  })

  test('Single edit propagates correctly', async function () {
    const handles = await mkHandles()
    await waitForInitialSync(handles.bindings, 1_000)

    // Type on doc0 and confirm the change reaches doc1.
    const ed0 = await vs.window.showTextDocument(handles.docs[0]!, { viewColumn: COLUMNS[0], preview: false })
    ed0.selection = new vs.Selection(0, 0, 0, 0)
    const text = 'PROBE\n'
    await vs.commands.executeCommand('default:type', { text })
    await waitForQuiescence(handles.bindings, 1_000)
    assert.strictEqual(handles.docs[1]!.getText(), text)
    await handles.dispose()
  })

  /** Drive a batch of edits, alternating between the two documents.
   * Not waiting between edits opens a local-vs-remote change race window. */
  const makeConcurrentEdits = async (handles: TestHandles) => {
    const rng = mulberry32(0xc0ffee)
    const NUM_EDITS = 100
    for (let i = 0; i < NUM_EDITS; i++) {
      await randomEditOn(handles.docs[i % 2]!, COLUMNS[i % 2]!, rng)
    }
  }

  const assertEqualStates = (handles: TestHandles) => {
    const [d0, d1] = handles.docs.map(d => d.getText())
    const [y0, y1] = handles.bindings.map(b => b.remoteYtext.toString())

    // Sanity check - YJs CRDT replicas converge.
    assert.strictEqual(y0, y1, diffMessage('Y.Text replicas (client0 vs client1)', y0!, y1!))
    // Whether docs correctly track CRDT replicas.
    assert.strictEqual(d0, y0, diffMessage('doc0 vs its Y.Text', d0!, y0!))
    assert.strictEqual(d1, y1, diffMessage('doc1 vs its Y.Text', d1!, y1!))
  }

  test('Concurrent edits settle on equal states', async function () {
    this.timeout(20_000)
    const ensureSyncTimeoutMs = 1_000
    const handles = await mkHandles(ensureSyncTimeoutMs)
    await waitForInitialSync(handles.bindings, 1_000)
    await makeConcurrentEdits(handles)
    // Wait for ensureSync
    await delay(ensureSyncTimeoutMs + 1_000)
    assertEqualStates(handles)
    await handles.dispose()
  })

  test('Concurrent edits settle on equal states (no ensureSync)', async function () {
    this.timeout(20_000)
    const handles = await mkHandles(0)
    await waitForInitialSync(handles.bindings, 1_000)
    // Ensure both documents are visible:
    // only `TextEditor.edit`s are expected to converge without ensureSync.
    await vs.window.showTextDocument(handles.docs[0]!, { viewColumn: COLUMNS[0], preview: false })
    await vs.window.showTextDocument(handles.docs[1]!, { viewColumn: COLUMNS[1], preview: false })
    await makeConcurrentEdits(handles)
    await waitForQuiescence(handles.bindings, 3_000)
    assertEqualStates(handles)
    await handles.dispose()
  })
})
