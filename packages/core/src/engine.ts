import { randomUUID } from 'node:crypto'
import { makeAuditEvent, MemoryAuditSink } from './audit.js'
import { contentHash, diffContent, mergeContent } from './diff.js'
import { PlugloadError } from './errors.js'
import { MemoryOperationStore } from './store.js'
import type { ApprovalReceipt, AuditSink, ContentAdapter, EnvironmentKind, JsonValue, OperationPlan, OperationRequest, OperationStore } from './types.js'

const HIGH_RISK = new Set(['delete', 'publish', 'rollback', 'promote', 'bulk-update'])

export interface OperationEngineOptions {
  environment: EnvironmentKind
  planTtlMs?: number
  approvalTtlMs?: number
  store?: OperationStore
  audit?: AuditSink
  now?: () => Date
}

export class OperationEngine {
  private readonly store: OperationStore
  readonly audit: AuditSink
  private readonly now: () => Date
  private readonly planTtlMs: number
  private readonly approvalTtlMs: number

  constructor(private readonly adapter: ContentAdapter, private readonly options: OperationEngineOptions) {
    this.store = options.store ?? new MemoryOperationStore()
    this.audit = options.audit ?? new MemoryAuditSink()
    this.now = options.now ?? (() => new Date())
    this.planTtlMs = options.planTtlMs ?? 15 * 60_000
    this.approvalTtlMs = options.approvalTtlMs ?? 10 * 60_000
  }

  async plan(request: OperationRequest): Promise<OperationPlan> {
    if (!request.reason.trim()) throw new PlugloadError('Every content change needs a reason.', 'REASON_REQUIRED', 'Explain why this change is needed and preview it again.')
    const createsDestination = request.action === 'create' || (request.action === 'promote' && request.target.kind === 'collection' && !request.target.id)
    const before = createsDestination ? undefined : await this.adapter.read(request.target, request)
    let after: JsonValue | undefined
    if (this.adapter.preview) after = await this.adapter.preview(request, before)
    else if (request.action === 'delete') after = undefined
    else if (request.action === 'publish') after = mergeContent(before, { ...(request.data ?? {}), _status: 'published' })
    else if (request.action === 'save-draft' || request.action === 'submit-review') after = mergeContent(before, { ...(request.data ?? {}), _status: 'draft' })
    else after = mergeContent(before, request.data)
    await this.adapter.validate(request.target, after, request.action)
    const diff = diffContent(before, after)
    const approvalReasons = approvalReasonsFor(this.options.environment, request)
    const now = this.now()
    const plan: OperationPlan = {
      id: randomUUID(),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.planTtlMs).toISOString(),
      environment: this.options.environment,
      request,
      before,
      after,
      diff,
      baselineHash: contentHash(before),
      approvalRequired: approvalReasons.length > 0,
      approvalReasons,
      risk: riskFor(this.options.environment, request),
      summary: summarize(request, diff.length),
    }
    await this.store.savePlan(plan)
    await this.audit.write(makeAuditEvent({ actor: request.actor, action: request.action, status: 'planned', environment: plan.environment, target: request.target, planId: plan.id, reason: request.reason, detail: { diffCount: diff.length, risk: plan.risk } }))
    return plan
  }

  async approve(planId: string, approvedBy: string, confirmation: string): Promise<ApprovalReceipt> {
    const plan = await this.requirePlan(planId)
    const expected = `APPROVE ${plan.id}`
    if (confirmation !== expected) {
      await this.audit.write(makeAuditEvent({ actor: approvedBy, action: plan.request.action, status: 'rejected', environment: plan.environment, target: plan.request.target, planId, reason: 'Approval confirmation mismatch' }))
      throw new PlugloadError('The approval confirmation did not match the plan.', 'APPROVAL_CONFIRMATION_MISMATCH', `Use the exact confirmation: ${expected}`)
    }
    const now = this.now()
    const approval: ApprovalReceipt = { id: randomUUID(), planId, approvedBy, approvedAt: now.toISOString(), expiresAt: new Date(now.getTime() + this.approvalTtlMs).toISOString(), confirmation }
    await this.store.saveApproval(approval)
    await this.audit.write(makeAuditEvent({ actor: approvedBy, action: plan.request.action, status: 'approved', environment: plan.environment, target: plan.request.target, planId, approvalId: approval.id, reason: plan.request.reason }))
    return approval
  }

  async apply(planId: string, actor: string, approvalId?: string): Promise<JsonValue | undefined> {
    const plan = await this.requirePlan(planId)
    try {
      if (plan.diff.length === 0) throw new PlugloadError('The preview contains no changes.', 'NO_CHANGES', 'Change the requested values or stop; there is nothing to apply.')
      if (plan.approvalRequired) await this.requireApproval(plan, approvalId)
      const createsDestination = plan.request.action === 'create' || (plan.request.action === 'promote' && plan.request.target.kind === 'collection' && !plan.request.target.id)
      const current = createsDestination ? undefined : await this.adapter.read(plan.request.target, plan.request)
      if (contentHash(current) !== plan.baselineHash) throw new PlugloadError('The content changed after this preview was created.', 'STALE_PLAN', 'Inspect the current document and create a fresh preview so no newer edits are overwritten.')
      const result = await this.adapter.execute(plan)
      await this.audit.write(makeAuditEvent({ actor, action: plan.request.action, status: 'succeeded', environment: plan.environment, target: plan.request.target, planId, ...(approvalId ? { approvalId } : {}), reason: plan.request.reason, detail: { diffCount: plan.diff.length } }))
      return result
    } catch (error) {
      await this.audit.write(makeAuditEvent({ actor, action: plan.request.action, status: error instanceof PlugloadError ? 'rejected' : 'failed', environment: plan.environment, target: plan.request.target, planId, ...(approvalId ? { approvalId } : {}), reason: error instanceof Error ? error.message : String(error) }))
      throw error
    }
  }

  private async requirePlan(id: string) {
    const plan = await this.store.getPlan(id)
    if (!plan) throw new PlugloadError('This operation plan does not exist.', 'PLAN_NOT_FOUND', 'Create a new preview and use its plan ID.')
    if (new Date(plan.expiresAt) <= this.now()) throw new PlugloadError('This operation plan has expired.', 'PLAN_EXPIRED', 'Create a fresh preview so it uses current content and schema.')
    return plan
  }

  private async requireApproval(plan: OperationPlan, id?: string) {
    if (!id) throw new PlugloadError('Explicit approval is required for this operation.', 'APPROVAL_REQUIRED', `Approve plan ${plan.id} after reviewing its diff, then pass the approval ID.`)
    const approval = await this.store.getApproval(id)
    if (!approval || approval.planId !== plan.id) throw new PlugloadError('The approval is missing or belongs to another plan.', 'INVALID_APPROVAL', 'Approve this exact plan and use the returned approval ID.')
    if (new Date(approval.expiresAt) <= this.now()) throw new PlugloadError('The approval has expired.', 'APPROVAL_EXPIRED', 'Review and approve the current plan again.')
  }
}

function approvalReasonsFor(environment: EnvironmentKind, request: OperationRequest): string[] {
  const reasons: string[] = []
  if (HIGH_RISK.has(request.action)) reasons.push(`${request.action} is a consequential operation`)
  if (environment === 'production') reasons.push('the destination is production')
  return reasons
}

function riskFor(environment: EnvironmentKind, request: OperationRequest): OperationPlan['risk'] {
  if (environment === 'production' && HIGH_RISK.has(request.action)) return 'critical'
  if (environment === 'production' || HIGH_RISK.has(request.action)) return 'high'
  if (request.action === 'update' || request.action === 'create') return 'medium'
  return 'low'
}

function summarize(request: OperationRequest, count: number) {
  const id = request.target.id ? ` ${request.target.id}` : ''
  return `${request.action} ${request.target.kind} ${request.target.slug}${id}: ${count} field-level change${count === 1 ? '' : 's'}`
}
