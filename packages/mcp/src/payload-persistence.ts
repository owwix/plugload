import { chainAuditEvent, type ApprovalReceipt, type AuditEvent, type AuditSink, type JsonValue, type OperationPlan, type OperationStore } from '@plugload/core'

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
        { name: 'digest', type: 'text', index: true },
        { name: 'state', type: 'select', defaultValue: 'pending', index: true, options: ['pending', 'applying', 'applied', 'failed', 'consumed'] },
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
        { name: 'status', type: 'select', required: true, options: ['planned', 'approved', 'executing', 'succeeded', 'rejected', 'failed', 'replayed'] },
        { name: 'environment', type: 'select', required: true, options: ['development', 'preview', 'staging', 'production'] },
        { name: 'target', type: 'json', required: true },
        { name: 'planId', type: 'text', index: true },
        { name: 'approvalId', type: 'text' },
        { name: 'reason', type: 'textarea' },
        { name: 'detail', type: 'json' },
        { name: 'previousHash', type: 'text', unique: true, index: true },
        { name: 'integrityHash', type: 'text', unique: true, index: true },
      ],
    },
  ]
}

export class PayloadOperationStore implements OperationStore {
  constructor(private readonly req: any) {}
  async savePlan(plan: OperationPlan) { await this.upsert(plan.id, 'plan', plan, plan.expiresAt, plan.digest, plan.state) }
  async getPlan(id: string) { return this.get<OperationPlan>(id, 'plan') }
  async saveApproval(approval: ApprovalReceipt) { await this.upsert(approval.id, 'approval', approval, approval.expiresAt, approval.planDigest, 'pending') }
  async getApproval(id: string) { return this.get<ApprovalReceipt>(id, 'approval') }

  async consumeApproval(id: string, planId: string, planDigest: string, consumedAt: string) {
    const current = await this.get<ApprovalReceipt>(id, 'approval')
    if (!current || current.planId !== planId || current.planDigest !== planDigest || current.consumedAt) return undefined
    const consumed = { ...current, consumedAt }
    const result = await this.req.payload.update({ collection: PLUGLOAD_OPERATIONS_SLUG, where: { and: [{ key: { equals: id } }, { kind: { equals: 'approval' } }, { digest: { equals: planDigest } }, { state: { equals: 'pending' } }] }, data: { state: 'consumed', value: consumed }, overrideAccess: true })
    return result.docs?.length ? consumed : undefined
  }

  async claimPlan(id: string, digest: string) {
    const result = await this.req.payload.update({ collection: PLUGLOAD_OPERATIONS_SLUG, where: { and: [{ key: { equals: id } }, { kind: { equals: 'plan' } }, { digest: { equals: digest } }, { state: { equals: 'pending' } }] }, data: { state: 'applying' }, overrideAccess: true })
    if (result.docs?.length) return 'claimed' as const
    const plan = await this.get<OperationPlan>(id, 'plan')
    if (!plan || plan.digest !== digest) return 'missing' as const
    return plan.state === 'applied' ? 'applied' as const : 'busy' as const
  }

  async completePlan(id: string, digest: string, resultValue: JsonValue | undefined, appliedAt: string) {
    const plan = await this.get<OperationPlan>(id, 'plan')
    if (!plan) throw new Error('Plan not found during completion')
    const value = { ...plan, state: 'applied' as const, appliedAt, ...(resultValue === undefined ? {} : { result: resultValue }) }
    const result = await this.req.payload.update({ collection: PLUGLOAD_OPERATIONS_SLUG, where: { and: [{ key: { equals: id } }, { digest: { equals: digest } }, { state: { equals: 'applying' } }] }, data: { state: 'applied', value }, overrideAccess: true })
    if (!result.docs?.length) throw new Error('Plan completion state mismatch')
  }

  async failPlan(id: string, digest: string) {
    const plan = await this.get<OperationPlan>(id, 'plan')
    if (!plan || plan.digest !== digest || plan.state !== 'applying') return
    await this.req.payload.update({ collection: PLUGLOAD_OPERATIONS_SLUG, where: { and: [{ key: { equals: id } }, { digest: { equals: digest } }, { state: { equals: 'applying' } }] }, data: { state: 'failed', value: { ...plan, state: 'failed' } }, overrideAccess: true })
  }

  private async upsert(key: string, kind: string, value: unknown, expiresAt: string, digest: string, state: string) {
    const existing = await this.req.payload.find({ collection: PLUGLOAD_OPERATIONS_SLUG, where: { key: { equals: key } }, limit: 1, depth: 0, overrideAccess: true })
    if (existing.docs[0]) await this.req.payload.update({ collection: PLUGLOAD_OPERATIONS_SLUG, id: existing.docs[0].id, data: { value, expiresAt, digest, state }, overrideAccess: true })
    else await this.req.payload.create({ collection: PLUGLOAD_OPERATIONS_SLUG, data: { key, kind, value, expiresAt, digest, state }, overrideAccess: true })
  }

  private async get<T>(key: string, kind: string): Promise<T | undefined> {
    const result = await this.req.payload.find({ collection: PLUGLOAD_OPERATIONS_SLUG, where: { and: [{ key: { equals: key } }, { kind: { equals: kind } }] }, limit: 1, depth: 0, overrideAccess: true })
    const doc = result.docs[0]
    if (!doc) return undefined
    return (kind === 'plan' ? { ...doc.value, state: doc.state } : doc.value) as T
  }
}

export class PayloadAuditSink implements AuditSink {
  constructor(private readonly req: any) {}
  async write(event: AuditEvent) {
    const latest = await this.req.payload.find({ collection: PLUGLOAD_AUDIT_SLUG, limit: 1, sort: '-timestamp', depth: 0, overrideAccess: true })
    const chained = chainAuditEvent(event, latest.docs[0]?.integrityHash)
    this.req.payload.logger.info({ msg: 'Plugload audit event', ...chained })
    await this.req.payload.create({ collection: PLUGLOAD_AUDIT_SLUG, data: { eventId: chained.id, ...chained }, overrideAccess: true })
  }
  async recent(limit: number): Promise<AuditEvent[]> {
    const result = await this.req.payload.find({ collection: PLUGLOAD_AUDIT_SLUG, limit, sort: '-timestamp', depth: 0, req: this.req, overrideAccess: false })
    return result.docs.map((doc: any) => ({
      id: doc.eventId,
      timestamp: doc.timestamp,
      actor: doc.actor,
      action: doc.action,
      status: doc.status,
      environment: doc.environment,
      target: doc.target,
      ...(doc.planId ? { planId: doc.planId } : {}),
      ...(doc.approvalId ? { approvalId: doc.approvalId } : {}),
      ...(doc.reason ? { reason: doc.reason } : {}),
      ...(doc.detail ? { detail: doc.detail } : {}),
      ...(doc.previousHash ? { previousHash: doc.previousHash } : {}),
      integrityHash: doc.integrityHash,
    }))
  }
}
