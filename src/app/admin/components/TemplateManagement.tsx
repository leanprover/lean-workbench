'use client'

import '@/app/components/Modal.css'

import { STANDARD_TOOLCHAIN_ID_RE, toolchainHasModules } from '@leanprover/workbench-shared'
import { useRouter } from 'next/navigation'
import { startTransition, use, useState } from 'react'
import { Button, Dialog, DialogTrigger, Heading, Modal } from 'react-aria-components'

import { availableTemplateSchemas, doTemplateCreation, editTemplateMetadata } from '@/app/admin/actions'
import CatchySuspense from '@/app/components/CatchySuspense'
import ErrorBox from '@/app/components/ErrorBox'
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
  const installedStandardToolchains = use(props.installedToolchainsPromise).filter(tc => toolchainHasModules(tc))

  return (
    <>
      {templates.filter(template => template.visible).length === 0 && (
        <ErrorBox>There are no user-visible templates. This will prevent users from creating new projects.</ErrorBox>
      )}
      <TemplateManagementList templates={templates} />
      <TrackedCommandForm
        disabled={installedStandardToolchains.length === 0}
        streamCommandKey='create-template'
        scope='admin'
        trackedCommandAction={doTemplateCreation}
        title='+ Create template'
        successAction={() => router.refresh()}
      >
        <CatchySuspense loading={<p>Loading available toolchains&hellip;</p>}>
          <TemplateCreationForm installedToolchains={installedStandardToolchains} />
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
  const router = useRouter()
  const [isModalOpen, setIsModalOpen] = useState(false)

  return (
    <li style={{ display: 'grid', gridTemplateColumns: '1fr auto', width: '100%' }}>
      <input type='hidden' name='id' value={props.id} />
      <div>
        <div style={{ fontSize: '13px' }}>
          {props.name}
          {!props.visible && <em> (hidden)</em>}
        </div>
        <div style={{ fontSize: '11px', color: '#90a4ae' }}>{props.description}</div>
      </div>
      <div className='actions'>
        <span style={{ fontSize: '0.8rem', color: '#90a4ae' }}>ID {props.id}</span>
        <DialogTrigger isOpen={isModalOpen} onOpenChange={setIsModalOpen}>
          <Button>Edit</Button>
          <Modal isDismissable>
            <Dialog>
              <Heading slot='title'>Edit Template {props.id}</Heading>
              <TemplateEditForm
                {...props}
                onSuccess={() => {
                  router.refresh()
                  setIsModalOpen(false)
                }}
              />
            </Dialog>
          </Modal>
        </DialogTrigger>
      </div>
    </li>
  )
}

function TemplateEditForm(props: TemplateInfo & { onSuccess: () => void }) {
  const [editError, editAction, editPending] = useServerAction(editTemplateMetadata, props.onSuccess)

  return (
    <form
      // Prevent form clearing without resorting to fully-controlled components:
      // https://github.com/react/react/issues/29034#issuecomment-2873390387
      onSubmit={event => {
        event.preventDefault()
        startTransition(() => editAction(new FormData(event.currentTarget)))
      }}
    >
      <input type='hidden' name='id' value={props.id} />
      <label>
        Name (required)
        <input disabled={editPending} type='text' name='name' defaultValue={props.name} />
      </label>
      <label>
        Description (optional)
        <input disabled={editPending} type='text' name='description' defaultValue={props.description} />
      </label>

      <label className='checkbox'>
        <input disabled={editPending} type='checkbox' name='projectVisible' defaultChecked={props.visible} /> Template
        appears in template selection menu
      </label>

      <div className='actions'>
        <Button isDisabled={editPending} className='primary' type='submit'>
          Submit
        </Button>
        <Button isDisabled={editPending} slot='close'>
          Close
        </Button>
      </div>

      <div style={{ color: '#f00' }}>{editError}</div>
    </form>
  )
}

function TemplateCreationForm(props: { installedToolchains: string[] }) {
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
        <select name='toolchain' value={toolchain} onChange={e => setToolchain(e.target.value)} className='roomy'>
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
        <select name='schema' className='roomy'>
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
