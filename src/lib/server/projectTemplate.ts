import fs from 'node:fs/promises'
import path from 'node:path'

import { getTemplatesDir } from '@leanprover/workbench-shared/node'
import z from 'zod'

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
 * Store metadata for a specified template,
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
