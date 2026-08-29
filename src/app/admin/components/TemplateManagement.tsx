'use client'

import { useRouter } from 'next/navigation'
import { use, useState } from 'react'

import { createMathlibTemplate, editTemplateMetadata } from '@/app/admin/actions'
import CatchySuspense from '@/app/components/CatchySuspense'
import DumbTTY from '@/app/components/DumbTTY'
import { useServerAction } from '@/lib/client/util'
import { type TemplateInfo } from '@/lib/server/util'

interface TemplateManagementProps {
  templates: Promise<TemplateInfo[]>
  toolchains: Promise<string[]>
}

export function TemplateManagement(props: TemplateManagementProps) {
  return (
    <section>
      <h2>Project Templates</h2>
      <CatchySuspense loading='Loading...'>
        <TemplateManagementList {...props} />
      </CatchySuspense>
      <CatchySuspense loading='Loading...'>
        <NewTemplate toolchains={props.toolchains} />
      </CatchySuspense>
    </section>
  )
}

function TemplateManagementList(props: TemplateManagementProps) {
  const templates = use(props.templates)
  return (
    <ul className='project-list'>
      {templates.map(template => (
        <TemplateRow key={template.id} {...template} />
      ))}
    </ul>
  )
}

function TemplateRow(props: TemplateInfo) {
  const id = props.id
  const [name, setName] = useState(props.name)
  const [description, setDescription] = useState(props.description)
  const [showForm, setShowForm] = useState(false)

  const [editError, editAction, editPending] = useServerAction(editTemplateMetadata, ({ name, description }) => {
    setName(name)
    setDescription(description ?? '')
    setShowForm(false)
  })

  return (
    <li>
      <form className='simple-action-form' action={editAction}>
        <input type='hidden' name='id' value={id} />
        {/* name */}
        <div hidden={showForm} style={{ gridArea: 'name' }}>
          <div style={{ fontSize: '13px' }}>{name}</div>
          <div style={{ fontSize: '11px', color: '#90a4ae' }}>{description}</div>
        </div>
        <label hidden={!showForm} className='visually-hidden' htmlFor={`templateName-${id}`}>
          Edit name of project {id}
        </label>
        <input
          style={{ gridArea: 'name' }}
          hidden={!showForm}
          disabled={editPending}
          type='text'
          id={`templateName-${id}`}
          name='name'
          placeholder={name}
        />
        {/* description */}
        <label hidden={!showForm} className='visually-hidden' htmlFor={`templateDesc-${id}`}>
          Edit description for project {id}
        </label>
        <input
          style={{ gridArea: 'desc' }}
          hidden={!showForm}
          disabled={editPending}
          type='text'
          id={`templateDesc-${id}`}
          name='description'
          defaultValue={description}
          min={1}
        />
        {/* ID and actions */}
        <div className='actions' style={{ gridArea: 'actions' }}>
          <span hidden={showForm} style={{ fontSize: '0.8rem', color: '#90a4ae' }}>
            ID {id}
          </span>
          <button hidden={!showForm} type='submit' disabled={editPending}>
            {editPending ? 'Saving...' : 'Save'}
          </button>
          {id !== 'blank' && (
            <button
              onClick={e => {
                e.preventDefault()
                setShowForm(v => !v)
              }}
              disabled={editPending}
            >
              {showForm ? 'Cancel' : 'Edit'}
            </button>
          )}
        </div>
        {/* Error message */}
        <div style={{ gridArea: 'error', color: '#f00' }}>{editError}</div>
      </form>
    </li>
  )
}

type State = 'closed' | 'form' | 'divert' | 'terminal'

function NewTemplate(_props: { toolchains: Promise<string[]> }) {
  const router = useRouter()
  const [state, setState] = useState<State>('closed')
  const [createError, createAction, createPending] = useServerAction(createMathlibTemplate, procState => {
    setState(procState === 'new-emitter' ? 'terminal' : 'divert')
  })

  if (state === 'closed') {
    return (
      <div style={{ marginTop: 16 }}>
        <button className='primary' onClick={() => setState('form')}>
          + New template
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
      <div style={{ paddingBottom: '5px', marginBottom: '5px', borderBottom: '1px solid #e4ebf3' }}>+ New template</div>
      {state === 'divert' && (
        <>
          <div>Workbench cannot perform this request, because is already a process of this type running</div>
          <div>
            <button
              onClick={e => {
                e.preventDefault()
                setState('terminal')
              }}
            >
              View running process
            </button>
          </div>
        </>
      )}
      {state === 'form' && (
        <>
          <CatchySuspense loading={<p>Loading toolchains&hellip;</p>}>
            <NewTemplateSelection />
          </CatchySuspense>
          {createError && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 8 }}>{createError}</div>}
          <div>
            <button type='submit' disabled={createPending}>
              Create
            </button>
            <button type='button' onClick={() => setState('closed')} disabled={createPending} style={{ marginLeft: 8 }}>
              Cancel
            </button>
          </div>
        </>
      )}
      {state === 'terminal' && (
        <>
          <DumbTTY streamingCommandKey='create-template' />
          <div style={{ paddingBottom: 11 }}>
            <button
              onClick={e => {
                e.preventDefault()
                setState('closed')
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

function NewTemplateSelection() {
  return (
    <>
      <input type='hidden' name='toolchain' value='leanprover/lean4:v4.33.1' />
      <input type='hidden' name='id' value='horrday' />
      <input type='hidden' name='name' value='the name' />
      <input type='hidden' name='description' value='the desc' />
    </>
  )
}
