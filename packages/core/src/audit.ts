import { randomUUID } from 'node:crypto'
import type { AuditEvent, AuditSink } from './types.js'

export class MemoryAuditSink implements AuditSink {
  readonly events: AuditEvent[] = []
  async write(event: AuditEvent) { this.events.push(structuredClone(event)) }
  async recent(limit: number) { return structuredClone(this.events.slice(-limit).reverse()) }
}

export class CompositeAuditSink implements AuditSink {
  constructor(private readonly sinks: AuditSink[]) {}
  async write(event: AuditEvent) { await Promise.all(this.sinks.map((sink) => sink.write(event))) }
}

export function makeAuditEvent(event: Omit<AuditEvent, 'id' | 'timestamp'>): AuditEvent {
  return { ...event, id: randomUUID(), timestamp: new Date().toISOString() }
}
