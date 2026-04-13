import { getConfig } from '$lib/server/config'
import { json } from '@sveltejs/kit'
import fs from 'fs'
import path from 'path'
import type { RequestHandler } from './$types'

interface TemplateMetadata {
  name: string
  description?: string
  packageSet?: string | null
}

function readTemplateMetadata(templatesDir: string, templateId: string): TemplateMetadata | null {
  const metaPath = path.join(templatesDir, templateId, 'metadata.json')
  if (!fs.existsSync(metaPath)) return null
  return JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as TemplateMetadata
}

function listTemplates(dataDir: string): { id: string; name: string; description: string }[] {
  const templatesDir = path.join(dataDir, 'templates')
  const result: { id: string; name: string; description: string }[] = [
    { id: 'blank', name: 'Blank', description: 'Empty workspace' },
  ]
  if (!fs.existsSync(templatesDir)) return result
  for (const entry of fs.readdirSync(templatesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const meta = readTemplateMetadata(templatesDir, entry.name)
    if (!meta) continue
    result.push({
      id: entry.name,
      name: meta.name,
      description: meta.description ?? '',
    })
  }
  return result
}

export const GET: RequestHandler = () => {
  const config = getConfig()
  return json(listTemplates(config.dataDir))
}
