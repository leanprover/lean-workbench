'use client'

import { use, useState } from 'react'

import { editTemplateMetadata } from '@/app/admin/actions'
import CatchySuspense from '@/app/components/CatchySuspense'
import { useServerAction } from '@/lib/client/util'
import { type TemplateInfo } from '@/lib/server/util'

interface TemplateManagementProps {
  templates: Promise<TemplateInfo[]>
}

export function TemplateManagement(props: TemplateManagementProps) {
  return (
    <section>
      <h2>Project Templates</h2>
      <CatchySuspense loading='Loading…'>
        <TemplateManagementList {...props} />
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
      <form className='simple-action-form' action={async data => editAction(data)}>
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
