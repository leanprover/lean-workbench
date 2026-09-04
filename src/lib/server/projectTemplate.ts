import fs from 'node:fs/promises'
import path from 'node:path'

import { STANDARD_TOOLCHAIN_ID_RE } from '@leanprover/workbench-shared'
import { getTemplatesDir } from '@leanprover/workbench-shared/node'
import z from 'zod'

import { githubAPI } from './github'
import { startTrackedCommand } from './trackedCommand'

export const zTemplateMetadata = z.object({
  name: z.string(),
  description: z.string().optional(),
  packageSet: z.string().optional(),
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
}

export async function listTemplates(): Promise<TemplateInfo[]> {
  const templatesDir = getTemplatesDir()

  const result: TemplateInfo[] = [{ id: 'blank', name: 'Blank', description: 'Empty workspace' }]
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

const MATHLIB_MAIN_LEAN = `import Mathlib

#check Nat.add_comm
`

const CSLIB_MAIN_LEAN = `import Cslib

#check Nat.add_comm
`

/**
 * Given a toolchain of the form `<namespace>:<tag>`,
 * where `<tag>` exists as a Mathlib version,
 * spawn a tracked command for a basic Mathlib template (key 'create-template')
 */
export async function startSchemaTemplate(toolchain: string, schema: TemplateSchemaId) {
  const scriptsDir = path.join(process.cwd(), 'scripts') // scripts/ is a sibling directory
  const [_all, _namespace, tag] = toolchain.match(STANDARD_TOOLCHAIN_ID_RE)!
  const workDir = await fs.mkdtemp('/tmp/template-create-')
  const metadata = TEMPLATE_METADATA_FROM_SCHEMA[schema](tag!)
  await fs.writeFile(path.join(workDir, 'metadata.json'), JSON.stringify(metadata))

  let script: string
  let args: string[]
  switch (schema) {
    case 'basic':
      script = 'create-basic.sh'
      args = [workDir, `basic-${tag!.replaceAll('.', '-')}`, toolchain]
      break
    case 'mathlib':
      await fs.writeFile(path.join(workDir, 'Main.lean'), MATHLIB_MAIN_LEAN)
      script = 'create-tagged-lib.sh'
      args = [workDir, `mathlib-${tag!.replaceAll('.', '-')}`, 'leanprover-community/mathlib4', 'mathlib', tag!]
      break
    case 'cslib':
      await fs.writeFile(path.join(workDir, 'Main.lean'), CSLIB_MAIN_LEAN)
      script = 'create-tagged-lib.sh'
      args = [workDir, `cslib-${tag!.replaceAll('.', '-')}`, 'leanprover/cslib', 'cslib', tag!]
      break
  }

  return startTrackedCommand('create-template', path.join(scriptsDir, script), args)
}
