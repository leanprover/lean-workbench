'use client'

import { useServerAction } from '@/lib/client/util'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import useSWR from 'swr'
import { createProject, listTemplates, type TemplateInfo } from './actions'

export function NewProjectForm() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const {
    data: templates,
    error: templatesError,
    isLoading: templatesPending,
  } = useSWR<TemplateInfo[], string>('listTemplates', async () => {
    const result = await listTemplates()
    if ('error' in result) throw new Error(result.error)
    return result.ok
  })

  const [chosenTemplate, setChosenTemplate] = useState<string>('blank')

  const [createError, createAction, createPending] = useServerAction(
    async (formData: FormData) => {
      const name = String(formData.get('name') ?? '').trim()
      if (!name) return { error: 'Name is required' }
      return createProject({ name, template: chosenTemplate })
    },
    () => {
      setOpen(false)
      router.refresh()
    },
  )

  if (!open) {
    return (
      <div style={{ marginTop: 16 }}>
        <button className='primary' onClick={() => setOpen(true)}>
          + New project
        </button>
      </div>
    )
  }

  const error = templatesError ?? createError

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
        {templatesPending && <p>Loading templates&hellip;</p>}
        {templates?.map(t => (
          <button
            key={t.id}
            type='button'
            className={`template-option ${chosenTemplate === t.id ? 'selected' : ''}`}
            onClick={() => setChosenTemplate(t.id)}
            disabled={createPending}
          >
            <strong>{t.name}</strong>
            <span>{t.description}</span>
          </button>
        ))}
      </div>
      {error && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 8 }}>{error}</div>}
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
