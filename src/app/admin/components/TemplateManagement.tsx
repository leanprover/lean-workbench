'use client'

import { STANDARD_TOOLCHAIN_ID_RE } from '@leanprover/workbench-shared'
import { useRouter } from 'next/navigation'
import { use, useState } from 'react'

import { availableTemplateSchemas, doTemplateCreation, editTemplateMetadata } from '@/app/admin/actions'
import CatchySuspense from '@/app/components/CatchySuspense'
import TrackedCommandForm from '@/app/components/TrackedCommandForm'
import { useServerAction, useThrowingSWR } from '@/lib/client/util'
import { type TemplateInfo } from '@/lib/server/projectTemplate'

interface TemplateManagementProps {
  templatesPromise: Promise<TemplateInfo[]>
  installedToolchainsPromise: Promise<string[]>
}

export function TemplateManagement(props: TemplateManagementProps) {
  const router = useRouter()
  const templates = use(props.templatesPromise)
  const installeStandardToolchains = use(props.installedToolchainsPromise).filter(tc =>
    STANDARD_TOOLCHAIN_ID_RE.test(tc),
  )

  return (
    <>
      <TemplateManagementList templates={templates} />
      <TrackedCommandForm
        disabled={installeStandardToolchains.length === 0}
        streamCommandKey='create-template'
        trackedCommandAction={doTemplateCreation}
        title='+ Create template'
        successAction={() => router.refresh()}
      >
        <CatchySuspense loading={<p>Loading available toolchains&hellip;</p>}>
          <TemplateCreationForm installedToolchains={installeStandardToolchains} />
        </CatchySuspense>
      </TrackedCommandForm>
    </>
  )
}

function TemplateManagementList(props: { templates: TemplateInfo[] }) {
  return (
    <ul className='project-list'>
      {props.templates.map(template => (
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

export function TemplateCreationForm(props: { installedToolchains: string[] }) {
  const [toolchain, setToolchain] = useState(props.installedToolchains[0]!)
  const [_toolchain, namespace, tag] = toolchain.match(STANDARD_TOOLCHAIN_ID_RE)!
  const { data: schemas } = useThrowingSWR(
    `toolchain-schema-${namespace}-${tag}`,
    async () => {
      const schemaIds = await availableTemplateSchemas(toolchain)
      return schemaIds.map(key => {
        switch (key) {
          case 'basic':
            return { key, name: 'Basic Lean template' }
          case 'mathlib':
            return { key, name: 'Mathlib template' }
          case 'cslib':
            return { key, name: 'CSLib template' }
        }
      })
    },
    {
      fallbackData: [{ key: 'basic', name: 'Loading…' } as const],
      revalidateIfStale: false,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    },
  )

  return (
    <>
      <label>
        Installed toolchain:{' '}
        <select name='toolchain' value={toolchain} onChange={e => setToolchain(e.target.value)}>
          {props.installedToolchains
            .map(tc => tc.match(STANDARD_TOOLCHAIN_ID_RE)!)
            .map(([all, _type, tag]) => (
              <option key={all} value={all}>
                {tag}
              </option>
            ))}
        </select>
      </label>
      <label>
        Template schema:{' '}
        <select name='schema'>
          {schemas.map(({ key, name }) => (
            <option value={key} key={key}>
              {name}
            </option>
          ))}
        </select>
      </label>
    </>
  )
}
