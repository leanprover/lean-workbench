'use client'

import { useRouter } from 'next/navigation'
import { use, useState } from 'react'

import CatchySuspense from '@/app/components/CatchySuspense'
import { useServerAction } from '@/lib/client/util'
import { type TemplateInfo } from '@/lib/server/projectTemplate'

import { createProject } from './actions'

interface NewProjectProps {
  templates: Promise<TemplateInfo[]>
}

export function NewProjectForm(props: NewProjectProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  const [createError, createAction, createPending] = useServerAction(createProject, () => {
    setOpen(false)
    router.refresh()
  })

  if (!open) {
    return (
      <div style={{ marginTop: 16 }}>
        <button className='primary' onClick={() => setOpen(true)}>
          + New project
        </button>
      </div>
    )
  }

  return (
    <form action={createAction} className='new-project' style={{ marginTop: 16 }}>
      <input
        name='name'
        type='text'
        onKeyDown={e => {
          if (e.key === 'Escape') setOpen(false)
        }}
        placeholder='Project name (letters, digits, hyphens, underscores)'
        maxLength={100}
        disabled={createPending}
        autoFocus
      />
      <div className='template-selector'>
        <CatchySuspense loading={<p>Loading templates&hellip;</p>}>
          <NewProjectSelection {...props} createPending={createPending} />
        </CatchySuspense>
      </div>
      {createError && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 8 }}>{createError}</div>}
      <div>
        <button type='submit' disabled={createPending}>
          Create
        </button>
        <button type='button' onClick={() => setOpen(false)} disabled={createPending} style={{ marginLeft: 8 }}>
          Cancel
        </button>
      </div>
    </form>
  )
}

function NewProjectSelection(props: NewProjectProps & { createPending: boolean }) {
  const [chosenTemplate, setChosenTemplate] = useState<string>('blank')
  const templates = use(props.templates)
  return (
    <>
      <input type='hidden' name='template' value={chosenTemplate} />
      {templates.map(t => (
        <button
          key={t.id}
          type='button'
          className={`template-option ${chosenTemplate === t.id ? 'selected' : ''}`}
          onClick={() => setChosenTemplate(t.id)}
          disabled={props.createPending}
        >
          <strong>{t.name}</strong>
          <span>{t.description}</span>
        </button>
      ))}
    </>
  )
}
