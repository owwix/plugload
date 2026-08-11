import type { ContentTypeSchema, FieldSchema, JsonValue, PayloadSchemaSnapshot } from './types.js'

type UnknownRecord = Record<string, any>

function accessState(value: unknown): 'allowed' | 'denied' | 'dynamic' | 'unspecified' {
  if (value === true) return 'allowed'
  if (value === false) return 'denied'
  if (typeof value === 'function') return 'dynamic'
  return 'unspecified'
}

function fieldName(field: UnknownRecord, index: number): string {
  return typeof field.name === 'string' ? field.name : `${field.type ?? 'field'}_${index}`
}

export function normalizeFields(fields: UnknownRecord[] = []): FieldSchema[] {
  return fields.map((field, index) => {
    const validation: string[] = []
    if (field.required) validation.push('required')
    if (field.min !== undefined) validation.push(`min:${field.min}`)
    if (field.max !== undefined) validation.push(`max:${field.max}`)
    if (field.minLength !== undefined) validation.push(`minLength:${field.minLength}`)
    if (field.maxLength !== undefined) validation.push(`maxLength:${field.maxLength}`)
    if (field.minRows !== undefined) validation.push(`minRows:${field.minRows}`)
    if (field.maxRows !== undefined) validation.push(`maxRows:${field.maxRows}`)
    if (typeof field.validate === 'function') validation.push('custom')
    const relationTo = typeof field.relationTo === 'string'
      ? [field.relationTo]
      : Array.isArray(field.relationTo) ? field.relationTo.filter((item): item is string => typeof item === 'string') : undefined
    const nested = Array.isArray(field.fields) ? normalizeFields(field.fields) : undefined
    const blocks = Array.isArray(field.blocks) ? field.blocks.map((block: UnknownRecord) => ({ slug: String(block.slug), fields: normalizeFields(block.fields) })) : undefined
    return {
      name: fieldName(field, index),
      type: String(field.type ?? 'unknown'),
      ...(typeof field.label === 'string' ? { label: field.label } : {}),
      required: Boolean(field.required),
      localized: Boolean(field.localized),
      unique: Boolean(field.unique),
      virtual: Boolean(field.virtual),
      hasMany: Boolean(field.hasMany),
      hidden: Boolean(field.hidden || field.admin?.hidden),
      access: Object.fromEntries(['read', 'create', 'update'].map((key) => [key, accessState(field.access?.[key])])),
      ...(relationTo?.length ? { relationTo } : {}),
      ...(field.options !== undefined ? { options: sanitizeValue(field.options) } : {}),
      validation,
      ...(nested?.length ? { fields: nested } : {}),
      ...(blocks?.length ? { blocks } : {}),
    }
  })
}

function sanitizeValue(value: unknown): JsonValue {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value as JsonValue
  if (Array.isArray(value)) return value.map(sanitizeValue)
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value as UnknownRecord).filter(([, v]) => typeof v !== 'function').map(([k, v]) => [k, sanitizeValue(v)]))
  return String(value)
}

function normalizeContentType(kind: 'collection' | 'global', config: UnknownRecord): ContentTypeSchema {
  const accessKeys = kind === 'collection' ? ['read', 'create', 'update', 'delete', 'readVersions'] : ['read', 'update', 'readVersions']
  return {
    kind,
    slug: String(config.slug),
    ...(config.labels ? { labels: sanitizeValue(config.labels) } : {}),
    versions: Boolean(config.versions),
    drafts: Boolean(config.versions && (config.versions === true || config.versions.drafts)),
    fields: normalizeFields(config.fields),
    access: Object.fromEntries(accessKeys.map((key) => [key, accessState(config.access?.[key])])),
  }
}

export function inspectPayloadConfig(config: UnknownRecord): PayloadSchemaSnapshot {
  const localization = config.localization
  const locales = Array.isArray(localization?.locales)
    ? localization.locales.map((locale: any) => typeof locale === 'string' ? locale : locale.code).filter(Boolean)
    : []
  return {
    generatedAt: new Date().toISOString(),
    localization: {
      enabled: Boolean(localization),
      locales,
      ...(localization?.defaultLocale ? { defaultLocale: String(localization.defaultLocale) } : {}),
      fallback: Boolean(localization?.fallback),
    },
    collections: (config.collections ?? []).map((item: UnknownRecord) => normalizeContentType('collection', item)),
    globals: (config.globals ?? []).map((item: UnknownRecord) => normalizeContentType('global', item)),
  }
}
