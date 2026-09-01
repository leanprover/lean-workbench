'use client'

import { useEffect, useRef, useState } from 'react'
import useSWR from 'swr'

import { LeanLspSession } from '@/lib/leanLspClient'

import { getProbeContext } from './actions'
import { PROBE_FILE } from './probe'

/** Interactive probe that the project's own files feed the view's LSP, with no VS Code in the loop:
 * on each (re)connect the server reads the current project file off the mount and hands it down as
 * context, and the live `lake serve` answers hover queries for whatever identifier you type —
 * including ones the project itself defines. */
export default function HelloClient({
  viewUrl,
  projectDir,
  userName,
  projectName,
}: {
  viewUrl: string
  projectDir: string
  userName: string
  projectName: string
}) {
  const sessionRef = useRef<LeanLspSession | null>(null)
  sessionRef.current ??= new LeanLspSession(viewUrl, projectDir, PROBE_FILE, () =>
    getProbeContext(userName, projectName),
  )
  useEffect(() => () => sessionRef.current?.close(), [])

  const [input, setInput] = useState('main')
  /** The submitted identifier, tagged with a submission count so that
   * resubmitting the same one runs a fresh lookup instead of reading SWR's cache. */
  const [query, setQuery] = useState<{ n: number; identifier: string } | null>(null)

  // The LSP round-trip is diagnostic, so surface failures here rather than to an error boundary.
  const { data, error, isLoading } = useSWR<string | null, unknown>(
    query && ['lean-lookup', query.n, query.identifier],
    () => sessionRef.current!.lookup(query!.identifier),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  )

  return (
    <main style={{ padding: '1rem', fontFamily: 'monospace' }}>
      <h1>Hello, Lean LSP</h1>
      <p>
        Querying a standalone <code>lake serve</code> with <code>{PROBE_FILE}</code> loaded as context. Type an
        identifier (e.g. <code>main</code>, <code>Nat.add</code>) to see its type and docstring.
      </p>
      <form
        onSubmit={e => {
          e.preventDefault()
          const identifier = input.trim()
          setQuery(prev => (identifier ? { n: (prev?.n ?? 0) + 1, identifier } : null))
        }}
      >
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder='identifier'
          style={{ fontFamily: 'inherit', padding: '0.25rem' }}
        />
        <button type='submit' style={{ marginLeft: '0.5rem' }}>
          Look up
        </button>
      </form>
      {query === null ? null : isLoading ? (
        <p>Looking up {query.identifier}…</p>
      ) : error ? (
        <pre style={{ color: 'crimson' }}>{String(error instanceof Error ? error.message : error)}</pre>
      ) : data ? (
        <pre style={{ whiteSpace: 'pre-wrap' }}>{data}</pre>
      ) : (
        <p>
          No information for <code>{query.identifier}</code>.
        </p>
      )}
    </main>
  )
}
