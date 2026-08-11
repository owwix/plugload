import { randomUUID } from 'node:crypto'
import type { AuditEvent, AuditSink } from './types.js'
import { contentHash } from './diff.js'

export class MemoryAuditSink implements AuditSink {
  readonly events: AuditEvent[] = []
  async write(event: AuditEvent) { this.events.push(chainAuditEvent(event, this.events.at(-1)?.integrityHash)) }
  async recent(limit: number) { return structuredClone(this.events.slice(-limit).reverse()) }
}

export class CompositeAuditSink implements AuditSink {
  constructor(private readonly sinks: AuditSink[]) {}
  async write(event: AuditEvent) { await Promise.all(this.sinks.map((sink) => sink.write(event))) }
}

export function makeAuditEvent(event: Omit<AuditEvent, 'id' | 'timestamp'>): AuditEvent {
  return { ...event, id: randomUUID(), timestamp: new Date().toISOString() }
}

export function chainAuditEvent(event: AuditEvent, previousHash?: string): AuditEvent {
  const chained = { ...event, previousHash: previousHash ?? 'GENESIS' }
  return { ...chained, integrityHash: contentHash(chained as unknown as import('./types.js').JsonValue) }
}

export function verifyAuditChain(events: AuditEvent[]): { valid: boolean; invalidEventId?: string } {
  let previousHash = 'GENESIS'
  for (const event of events) {
    const { integrityHash, ...unsigned } = event
    if (!integrityHash || unsigned.previousHash !== previousHash || contentHash(unsigned as unknown as import('./types.js').JsonValue) !== integrityHash) return { valid: false, invalidEventId: event.id }
    previousHash = integrityHash
  }
  return { valid: true }
}
