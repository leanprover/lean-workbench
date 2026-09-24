import fs from 'node:fs/promises'
import path from 'node:path'

import { STANDARD_TOOLCHAIN_ID_RE, zTemplateId } from '@leanprover/workbench-shared'
import { getScriptsDir, getTemplatesDir, makeTempBuildDir } from '@leanprover/workbench-shared/node'
import z from 'zod'

import { githubAPI } from './github'
import { startTrackedCommand } from './trackedCommand'

export const zTemplateMetadata = z.object({
  name: z.string(),
  description: z.string().optional(),
  packageSet: z.string().optional(),
  hidden: z.boolean().optional(),
})

export type TemplateMetadata = z.infer<typeof zTemplateMetadata>

/**
 * Read metadata for a specified template,
 * raising an exception if the file is missing or un-parseable.
 */
export async function readTemplateMetadata(templateId: string): Promise<TemplateMetadata> {
  const metaPath = path.join(getTemplatesDir(), templateId, 'metadata.json')
  const raw = await fs.readFile(metaPath, 'utf-8')
  return zTemplateMetadata.parse(JSON.parse(raw))
}

/**
 * Store metadata for a specified template.
 */
export async function saveTemplateMetadata(templateId: string, config: TemplateMetadata) {
  const metaPath = path.join(getTemplatesDir(), templateId, 'metadata.json')
  await fs.writeFile(metaPath, JSON.stringify(/* Defensive re-validation */ zTemplateMetadata.parse(config)))
}

export interface TemplateInfo {
  id: string
  name: string
  description: string
  visible: boolean
}

export async function listTemplates(): Promise<TemplateInfo[]> {
  const templatesDir = getTemplatesDir()

  const result: TemplateInfo[] = []
  const entries = await fs.readdir(templatesDir, { withFileTypes: true })

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    let meta: TemplateMetadata
    try {
      meta = await readTemplateMetadata(entry.name)
    } catch (err) {
      console.error(`Skipping template '${entry.name}' due to metadata error`, err)
      continue
    }
    result.push({
      id: entry.name,
      name: meta.name,
      description: meta.description ?? '',
      visible: !meta.hidden,
    })
  }

  return result
}

// --- Template Schemas ---

export const TEMPLATE_SCHEMA_IDS = ['basic', 'mathlib', 'cslib'] as const
export type TemplateSchemaId = (typeof TEMPLATE_SCHEMA_IDS)[number]

export const TEMPLATE_METADATA_FROM_SCHEMA: Record<TemplateSchemaId, (tag: string) => TemplateMetadata> = {
  basic: tag => ({ name: `Lean ${tag}`, description: 'Minimal Lean project' }),
  mathlib: tag => ({
    name: `Lean ${tag} + Mathlib`,
    description: 'Pre-built Mathlib dependency',
    packageSet: `mathlib-${tag.replaceAll('.', '-')}`,
  }),
  cslib: tag => ({
    name: `Lean ${tag} + CSLib`,
    description: 'Pre-built CSLib dependency',
    packageSet: `cslib-${tag.replaceAll('.', '-')}`,
  }),
}

/**
 * Get the (always non-empty) list of templates that can be created
 * from a fully qualified toolchain (e.g. `leanprover/lean4:v4.32.0`).
 */
export async function getAvailableTemplateSchemas(toolchain: string): Promise<TemplateSchemaId[]> {
  const match = toolchain.match(STANDARD_TOOLCHAIN_ID_RE)
  if (!match) return ['basic'] as const
  const [_lean, type, tag] = match

  if (type !== 'lean4') return ['basic'] as const

  const [isMathlibTag, isCSLibTag] = await Promise.all([
    githubAPI(`/repos/leanprover-community/mathlib4/git/ref/tags/${tag}`).then(res => res.ok),
    githubAPI(`/repos/leanprover/cslib/git/ref/tags/${tag}`).then(res => res.ok),
  ])

  return [['basic'] as const, isMathlibTag ? (['mathlib'] as const) : [], isCSLibTag ? (['cslib'] as const) : []].flat()
}

const BASIC_MAIN_LEAN = `module

#check Nat.add_comm

#eval show IO Unit from
  IO.println "Hello, world!"
`

const MATHLIB_MAIN_LEAN = `module

import Mathlib

#check Nat.add_comm
`

const CSLIB_MAIN_LEAN = `module

import Cslib

#check Nat.add_comm
`

export const zTemplateCreation = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('schema'),
    toolchain: z.string().regex(STANDARD_TOOLCHAIN_ID_RE),
    schema: z.enum(['basic', 'mathlib', 'cslib']),
  }),
  z.object({
    type: z.literal('gitRepo'),
    gitRepo: z.string('Git repository is required').trim().min(1, 'Git repository is required'),
    gitRef: z.string('Git branch, tag, or commit required').trim().min(1, 'Git branch, tag, or commit required'),
    templateId: zTemplateId,
    templateName: z.string('Template name required').trim().min(1, 'Template name required'),
  }),
])
type TemplateCreation = z.infer<typeof zTemplateCreation>

/**
 * Given a toolchain of the form `<namespace>:<tag>`,
 * where `<tag>` exists as a Mathlib version,
 * spawn a tracked command for a basic Mathlib template (key 'create-template')
 */
export async function startTemplateCreation(props: TemplateCreation) {
  const workDir = await makeTempBuildDir('template-create')
  await fs.mkdir(path.join(workDir, 'build'))

  let metadata: TemplateMetadata
  let script: string
  let args: string[]
  switch (props.type) {
    case 'schema': {
      const [_all, _namespace, tag] = props.toolchain.match(STANDARD_TOOLCHAIN_ID_RE)!
      metadata = TEMPLATE_METADATA_FROM_SCHEMA[props.schema](tag!)
      switch (props.schema) {
        case 'basic':
          await fs.writeFile(path.join(workDir, 'build', 'Main.lean'), BASIC_MAIN_LEAN)
          script = 'create-basic.sh'
          args = [workDir, `basic-${tag!.replaceAll('.', '-')}`, props.toolchain]
          break
        case 'mathlib':
          await fs.writeFile(path.join(workDir, 'build', 'Main.lean'), MATHLIB_MAIN_LEAN)
          script = 'create-tagged-lib.sh'
          args = [workDir, `mathlib-${tag!.replaceAll('.', '-')}`, 'leanprover-community/mathlib4', 'mathlib', tag!]
          break
        case 'cslib':
          await fs.writeFile(path.join(workDir, 'build', 'Main.lean'), CSLIB_MAIN_LEAN)
          script = 'create-tagged-lib.sh'
          args = [workDir, `cslib-${tag!.replaceAll('.', '-')}`, 'leanprover/cslib', 'cslib', tag!]
          break
      }
      break
    }
    case 'gitRepo': {
      metadata = { name: props.templateName, packageSet: props.templateId }
      script = 'create-gitrepo.sh'
      args = [workDir, props.templateId, props.gitRepo, props.gitRef]
    }
  }

  await fs.writeFile(path.join(workDir, 'build', 'metadata.json'), JSON.stringify(metadata))
  // Both parts of this path are opaque to Turbopack, which would otherwise trace the whole
  // project into the build output. Our deployment ships the repo anyway; see AGENTS.md.
  const scriptPath = path.join(/*turbopackIgnore: true*/ getScriptsDir(), script)
  return startTrackedCommand('create-template', { kind: 'admin' }, scriptPath, args)
}
