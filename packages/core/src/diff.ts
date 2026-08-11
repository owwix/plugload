import { createHash } from 'node:crypto'
import type { DiffEntry, JsonObject, JsonValue } from './types.js'

export function stableStringify(value: JsonValue | undefined): string {
  if (value === undefined) return 'undefined'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
  return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`).join(',')}}`
}

export function contentHash(value: JsonValue | undefined): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex')
}

export function mergeContent(before: JsonValue | undefined, patch: JsonObject | undefined): JsonValue | undefined {
  if (!patch) return before
  if (!before || Array.isArray(before) || typeof before !== 'object') return structuredClone(patch)
  return deepMerge(before as JsonObject, patch)
}

function deepMerge(base: JsonObject, patch: JsonObject): JsonObject {
  const result = structuredClone(base)
  for (const [key, value] of Object.entries(patch)) {
    const current = result[key]
    result[key] = isObject(current) && isObject(value) ? deepMerge(current, value) : structuredClone(value)
  }
  return result
}

function isObject(value: JsonValue | undefined): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function diffContent(before: JsonValue | undefined, after: JsonValue | undefined, path = '$'): DiffEntry[] {
  if (stableStringify(before) === stableStringify(after)) return []
  if (before === undefined) return [{ path, kind: 'add', after: after as JsonValue }]
  if (after === undefined) return [{ path, kind: 'remove', before: before as JsonValue }]
  if (!isObject(before) || !isObject(after)) return [{ path, kind: 'change', before, after }]
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
  return keys.flatMap((key) => diffContent(before[key], after[key], `${path}.${key}`))
}
