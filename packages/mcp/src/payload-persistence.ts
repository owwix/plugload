import type { ApprovalReceipt, AuditEvent, AuditSink, OperationPlan, OperationStore } from '@plugload/core'

export const PLUGLOAD_OPERATIONS_SLUG = 'plugload-operations'
export const PLUGLOAD_AUDIT_SLUG = 'plugload-audit-events'

export function createPlugloadCollections(): any[] {
  return [
    {
      slug: PLUGLOAD_OPERATIONS_SLUG,
      admin: { hidden: true },
      access: { read: () => false, create: () => false, update: () => false, delete: () => false },
      fields: [
        { name: 'key', type: 'text', required: true, unique: true, index: true },
        { name: 'kind', type: 'select', required: true, options: ['plan', 'approval'] },
        { name: 'value', type: 'json', required: true },
        { name: 'expiresAt', type: 'date', required: true, index: true },
      ],
    },
    {
      slug: PLUGLOAD_AUDIT_SLUG,
      admin: { useAsTitle: 'action' },
      access: { read: ({ req }: any) => Boolean(req.user), create: () => false, update: () => false, delete: () => false },
      fields: [
        { name: 'eventId', type: 'text', required: true, unique: true, index: true },
        { name: 'timestamp', type: 'date', required: true, index: true },
        { name: 'actor', type: 'text', required: true, index: true },
        { name: 'action', type: 'text', required: true, index: true },
        { name: 'status', type: 'select', required: true, options: ['planned', 'approved', 'succeeded', 'rejected', 'failed'] },
        { name: 'environment', type: 'select', required: true, options: ['development', 'preview', 'staging', 'production'] },
        { name: 'target', type: 'json', required: true },
        { name: 'planId', type: 'text', index: true },
        { name: 'approvalId', type: 'text' },
        { name: 'reason', type: 'textarea' },
        { name: 'detail', type: 'json' },
      ],
    },
  ]
}

export class PayloadOperationStore implements OperationStore {
  constructor(private readonly req: any) {}
  async savePlan(plan: OperationPlan) { await this.upsert(plan.id, 'plan', plan, plan.expiresAt) }
  async getPlan(id: string) { return this.get<OperationPlan>(id, 'plan') }
  async saveApproval(approval: ApprovalReceipt) { await this.upsert(approval.id, 'approval', approval, approval.expiresAt) }
  async getApproval(id: string) { return this.get<ApprovalReceipt>(id, 'approval') }

  private async upsert(key: string, kind: string, value: unknown, expiresAt: string) {
    const existing = await this.req.payload.find({ collection: PLUGLOAD_OPERATIONS_SLUG, where: { key: { equals: key } }, limit: 1, depth: 0, overrideAccess: true })
    if (existing.docs[0]) await this.req.payload.update({ collection: PLUGLOAD_OPERATIONS_SLUG, id: existing.docs[0].id, data: { value, expiresAt }, overrideAccess: true })
    else await this.req.payload.create({ collection: PLUGLOAD_OPERATIONS_SLUG, data: { key, kind, value, expiresAt }, overrideAccess: true })
  }

  private async get<T>(key: string, kind: string): Promise<T | undefined> {
    const result = await this.req.payload.find({ collection: PLUGLOAD_OPERATIONS_SLUG, where: { and: [{ key: { equals: key } }, { kind: { equals: kind } }] }, limit: 1, depth: 0, overrideAccess: true })
    return result.docs[0]?.value as T | undefined
  }
}

export class PayloadAuditSink implements AuditSink {
  constructor(private readonly req: any) {}
  async write(event: AuditEvent) {
    this.req.payload.logger.info({ msg: 'Plugload audit event', ...event })
    await this.req.payload.create({ collection: PLUGLOAD_AUDIT_SLUG, data: { eventId: event.id, ...event }, overrideAccess: true })
  }
  async recent(limit: number): Promise<AuditEvent[]> {
    const result = await this.req.payload.find({ collection: PLUGLOAD_AUDIT_SLUG, limit, sort: '-timestamp', depth: 0, req: this.req, overrideAccess: false })
    return result.docs.map(({ eventId, ...doc }: any) => ({ ...doc, id: eventId }))
  }
}
