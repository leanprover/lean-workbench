'use client'

import { useRouter } from 'next/navigation'
import { Suspense, use, useState } from 'react'
import z from 'zod'

import { installToolchainVersion, uninstallToolchainVersion } from '@/app/admin/actions'
import CatchySuspense from '@/app/components/CatchySuspense'
import DumbTTY from '@/app/components/DumbTTY'
import { useServerAction, useThrowingSWR } from '@/lib/client/util'

interface ToolchainManagementProps {
  toolchains: Promise<string[]>
}

export function ToolchainManagement(props: ToolchainManagementProps) {
  return (
    <section>
      <h2>Lean Toolchains</h2>
      <Suspense fallback='Loading...'>
        <ToolchainManagementBody {...props} />
      </Suspense>
      <NewToolchain />
    </section>
  )
}

function ToolchainManagementBody(props: ToolchainManagementProps) {
  const toolchains = use(props.toolchains)
  return (
    <ul className='project-list'>
      {toolchains.map(toolchain => (
        <ToolchainRow key={toolchain} toolchain={toolchain} />
      ))}
    </ul>
  )
}

function ToolchainRow(props: { toolchain: string }) {
  const [confirm, setConfirm] = useState(false)
  const [error, action, pending] = useServerAction(uninstallToolchainVersion)

  return (
    <li>
      <form className='simple-action-form' action={action}>
        <div style={{ gridArea: 'name' }}>{props.toolchain}</div>
        <input type='hidden' name='toolchain' value={props.toolchain} />
        <div className='actions' style={{ gridArea: 'actions' }}>
          {!confirm && (
            <button
              onClick={e => {
                e.preventDefault()
                setConfirm(true)
              }}
            >
              Remove Toolchain
            </button>
          )}
          {confirm && (
            <>
              <button disabled={pending} type='submit'>
                Confirm Removing Toolchain
              </button>
              <button
                disabled={pending}
                onClick={e => {
                  e.preventDefault()
                  setConfirm(false)
                }}
              >
                Cancel
              </button>
            </>
          )}
        </div>
        <div style={{ gridArea: 'error', color: '#f00' }}>{error}</div>
      </form>
    </li>
  )
}

function NewToolchain() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [terminal, setTerminal] = useState(false)
  const [createError, createAction, createPending] = useServerAction(installToolchainVersion, () => {
    setTerminal(true)
  })

  if (!open) {
    return (
      <div style={{ marginTop: 16 }}>
        <button className='primary' onClick={() => setOpen(true)}>
          + New toolchain
        </button>
      </div>
    )
  }

  return (
    <form
      action={createAction}
      className='new-project'
      style={{ fontSize: 14, marginTop: 16, display: 'grid', gap: '0.5rem' }}
    >
      <div style={{ paddingBottom: '5px', marginBottom: '5px', borderBottom: '1px solid #e4ebf3' }}>
        + New toolchain
      </div>
      {!terminal && (
        <>
          <CatchySuspense loading={<p>Loading toolchains&hellip;</p>}>
            <NewToolchainSelection />
          </CatchySuspense>
          {createError && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 8 }}>{createError}</div>}
          <div>
            <button type='submit' disabled={createPending}>
              Create
            </button>
            <button type='button' onClick={() => setOpen(false)} disabled={createPending} style={{ marginLeft: 8 }}>
              Cancel
            </button>
          </div>
        </>
      )}
      {terminal && (
        <>
          <DumbTTY streamingCommandKey='elan' />
          <div style={{ paddingBottom: 11 }}>
            <button
              onClick={e => {
                e.preventDefault()
                setOpen(false)
                router.refresh()
              }}
            >
              Close
            </button>
          </div>
        </>
      )}
    </form>
  )
}

const zLeanRelease = z.object({ name: z.string(), created_at: z.iso.datetime() })
const zLeanReleases = z.object({
  version: z.literal('1'),
  stable: z.array(zLeanRelease.transform(tc => ({ type: 'stable' as const, ...tc }))),
  beta: z.array(zLeanRelease.transform(tc => ({ type: 'beta' as const, ...tc }))),
  nightly: z.array(zLeanRelease.transform(tc => ({ type: 'nightly' as const, ...tc }))),
})

function NewToolchainSelection() {
  const { data: toolchains } = useThrowingSWR(
    'releases.lean-lang.org',
    async () => {
      const res = await fetch('https://release.lean-lang.org')
      return zLeanReleases.parse(await res.json())
    },
    { suspense: true, revalidateIfStale: false, revalidateOnFocus: false, revalidateOnReconnect: false },
  )
  const [stable, setStable] = useState(true)
  const [beta, setBeta] = useState(false)
  const [nightly, setNightly] = useState(false)
  const count = (stable ? 1 : 0) + (beta ? 1 : 0) + (nightly ? 1 : 0)
  const all = [stable ? toolchains.stable : [], beta ? toolchains.beta : [], nightly ? toolchains.nightly : []]
    .flat()
    .toSorted((a, b) => (a.created_at > b.created_at ? -1 : a.created_at < b.created_at ? 1 : 0))

  return (
    <>
      <div className='check-seq'>
        <label>
          <input
            id='tc-stable'
            type='checkbox'
            checked={stable}
            disabled={stable && count === 1}
            onChange={() => setStable(s => !s)}
          />
          Stable
        </label>
        <label>
          <input
            id='tc-beta'
            type='checkbox'
            checked={beta}
            disabled={beta && count === 1}
            onChange={() => setBeta(s => !s)}
          />
          Beta
        </label>
        <label>
          <input
            id='tc-nightly'
            type='checkbox'
            checked={nightly}
            disabled={nightly && count === 1}
            onChange={() => setNightly(s => !s)}
          />
          Nightly
        </label>
      </div>
      <select name='selectedToolchain' defaultValue={`stable ${toolchains.stable[0]!}`}>
        {all.map(({ type, name }) => (
          <option key={`${type} ${name}`} value={`${type} ${name}`}>
            {name}
          </option>
        ))}
      </select>
    </>
  )
}
