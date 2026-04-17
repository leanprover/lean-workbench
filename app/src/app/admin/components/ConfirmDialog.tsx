'use client'

import { useEffect, useRef, useState } from 'react'
import type { ConfirmAction } from './types'

export function ConfirmDialog({ action, onClose }: { action: ConfirmAction; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    dialogRef.current?.showModal()
  }, [])

  async function handleConfirm() {
    setBusy(true)
    try {
      await action.onConfirm()
      onClose()
    } catch {
      setBusy(false)
    }
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      style={{
        border: '1px solid #E4EBF3',
        borderRadius: 8,
        padding: 24,
        maxWidth: 400,
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        margin: 0,
      }}
    >
      <h3 style={{ margin: '0 0 8px' }}>{action.title}</h3>
      <p style={{ margin: '0 0 20px', color: '#555' }}>{action.message}</p>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button className={action.danger ? 'danger' : 'primary'} onClick={() => void handleConfirm()} disabled={busy}>
          {busy ? '...' : action.confirmLabel}
        </button>
      </div>
    </dialog>
  )
}
