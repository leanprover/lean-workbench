'use client'

import friendlyWords from 'friendly-words'
import { useRouter } from 'next/navigation'
import { use, useMemo, useState } from 'react'

import CatchySuspense from '@/app/components/CatchySuspense'
import { useServerAction } from '@/lib/client/util'
import { type TemplateInfo } from '@/lib/server/projectTemplate'

import { createProject } from './actions'

interface NewProjectProps {
  templates: Promise<TemplateInfo[]>
}

function generateSuggestion() {
  const predicate = friendlyWords.predicates[Math.floor(Math.random() * friendlyWords.predicates.length)]!
  const object = friendlyWords.objects[Math.floor(Math.random() * friendlyWords.objects.length)]
  return `${predicate}-${object}`
}

export function NewProjectForm(props: NewProjectProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const friendlySuggestion = useMemo(() => (open ? generateSuggestion() : ''), [open])

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
      <div className='template-selector'>
        <CatchySuspense loading={<p>Loading templates&hellip;</p>}>
          <NewProjectSelection {...props} createPending={createPending} />
        </CatchySuspense>
      </div>
      <input type='hidden' name='nameSuggestion' value={friendlySuggestion} />
      <label style={{ fontSize: '14px' }}>
        Project name (letters, digits, hyphens, underscores)
        <input
          name='projectName'
          type='text'
          placeholder={friendlySuggestion}
          maxLength={100}
          disabled={createPending}
          autoFocus
        />
      </label>
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
  const templates = use(props.templates)
  const [chosenTemplate, setChosenTemplate] = useState<string | undefined>(templates[0]?.id)
  if (!chosenTemplate) {
    return <>No project templates are available</>
  }

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
