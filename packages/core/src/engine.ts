import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
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
  approvalSigningSecret?: string
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
    if (request.action === 'promote') {
      if (!request.sourceEnvironment || !request.destinationEnvironment) throw new PlugloadError('Promotion requires explicit source and destination environments.', 'PROMOTION_ENVIRONMENTS_REQUIRED', 'Provide both environments from trusted project configuration.')
      if (request.destinationEnvironment !== this.options.environment || request.sourceEnvironment === request.destinationEnvironment) throw new PlugloadError('The promotion environment binding is invalid.', 'PROMOTION_ENVIRONMENT_MISMATCH', `The destination must be ${this.options.environment} and differ from the source.`)
    }
    if (request.action === 'bulk-update' && (!request.ids?.length || new Set(request.ids).size !== request.ids.length)) throw new PlugloadError('Bulk update requires a non-empty list of unique document IDs.', 'INVALID_BULK_IDS', 'Provide each intended document ID exactly once.')
    const createsDestination = request.action === 'create' || (request.action === 'promote' && request.target.kind === 'collection' && !request.target.id)
    const before = createsDestination ? undefined : await this.adapter.read(request.target, request)
    const schemaHash = await this.adapter.schemaFingerprint?.(request.target)
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
    const unsignedPlan = {
      id: randomUUID(),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.planTtlMs).toISOString(),
      environment: this.options.environment,
      request,
      before,
      after,
      diff,
      baselineHash: contentHash(before),
      ...(schemaHash ? { schemaHash } : {}),
      approvalRequired: approvalReasons.length > 0,
      approvalReasons,
      risk: riskFor(this.options.environment, request),
      summary: summarize(request, diff.length),
      state: 'pending' as const,
    }
    const plan: OperationPlan = { ...unsignedPlan, digest: digestForPlan(unsignedPlan) }
    await this.store.savePlan(plan)
    await this.audit.write(makeAuditEvent({ actor: request.actor, action: request.action, status: 'planned', environment: plan.environment, target: request.target, planId: plan.id, reason: request.reason, detail: { diffCount: diff.length, risk: plan.risk } }))
    return plan
  }

  async approve(planId: string, approvedBy: string, confirmation: string): Promise<ApprovalReceipt> {
    const plan = await this.requirePlan(planId)
    this.verifyPlanDigest(plan)
    if (plan.request.actor === approvedBy) throw new PlugloadError('The person or agent that planned an operation cannot approve it.', 'SELF_APPROVAL_FORBIDDEN', 'Use a separately authenticated Payload user who is authorized to approve this environment.')
    const expected = approvalConfirmation(plan)
    if (confirmation !== expected) {
      await this.audit.write(makeAuditEvent({ actor: approvedBy, action: plan.request.action, status: 'rejected', environment: plan.environment, target: plan.request.target, planId, reason: 'Approval confirmation mismatch' }))
      throw new PlugloadError('The approval confirmation did not match the plan.', 'APPROVAL_CONFIRMATION_MISMATCH', `Use the exact confirmation: ${expected}`)
    }
    const now = this.now()
    const secret = this.requireApprovalSecret()
    const unsigned = { id: randomUUID(), planId, approvedBy, approvedAt: now.toISOString(), expiresAt: new Date(now.getTime() + this.approvalTtlMs).toISOString(), confirmation, planDigest: plan.digest, environment: plan.environment, action: plan.request.action }
    const approval: ApprovalReceipt = { ...unsigned, signature: signApproval(unsigned, secret) }
    await this.store.saveApproval(approval)
    await this.audit.write(makeAuditEvent({ actor: approvedBy, action: plan.request.action, status: 'approved', environment: plan.environment, target: plan.request.target, planId, approvalId: approval.id, reason: plan.request.reason }))
    return approval
  }

  async apply(planId: string, actor: string, approvalId?: string): Promise<JsonValue | undefined> {
    const plan = await this.requirePlan(planId)
    this.verifyPlanDigest(plan)
    if (plan.state === 'applied') {
      await this.audit.write(makeAuditEvent({ actor, action: plan.request.action, status: 'replayed', environment: plan.environment, target: plan.request.target, planId, reason: 'Idempotent replay returned the stored result.' }))
      return plan.result
    }
    try {
      if (plan.diff.length === 0) throw new PlugloadError('The preview contains no changes.', 'NO_CHANGES', 'Change the requested values or stop; there is nothing to apply.')
      const approval = plan.approvalRequired ? await this.requireApproval(plan, approvalId) : undefined
      const createsDestination = plan.request.action === 'create' || (plan.request.action === 'promote' && plan.request.target.kind === 'collection' && !plan.request.target.id)
      const current = createsDestination ? undefined : await this.adapter.read(plan.request.target, plan.request)
      if (contentHash(current) !== plan.baselineHash) throw new PlugloadError('The content changed after this preview was created.', 'STALE_PLAN', 'Inspect the current document and create a fresh preview so no newer edits are overwritten.')
      if (plan.schemaHash && this.adapter.schemaFingerprint && await this.adapter.schemaFingerprint(plan.request.target) !== plan.schemaHash) throw new PlugloadError('The Payload schema changed after this preview was created.', 'STALE_SCHEMA', 'Inspect the updated schema and create a fresh plan before applying content.')
      const claim = await this.store.claimPlan(plan.id, plan.digest)
      if (claim === 'applied') {
        const applied = await this.store.getPlan(plan.id)
        return applied?.result
      }
      if (claim !== 'claimed') throw new PlugloadError('This plan is already being applied or can no longer be used.', 'PLAN_NOT_APPLICABLE', 'Inspect the audit trail and create a fresh plan if the prior attempt did not succeed.')
      if (approval) {
        const consumed = await this.store.consumeApproval(approval.id, plan.id, plan.digest, this.now().toISOString())
        if (!consumed) throw new PlugloadError('This approval has already been used.', 'APPROVAL_ALREADY_USED', 'Create and independently approve a fresh plan.')
      }
      await this.audit.write(makeAuditEvent({ actor, action: plan.request.action, status: 'executing', environment: plan.environment, target: plan.request.target, planId, ...(approvalId ? { approvalId } : {}), reason: plan.request.reason, detail: { diffCount: plan.diff.length } }))
      const result = await this.adapter.execute(plan)
      await this.store.completePlan(plan.id, plan.digest, result, this.now().toISOString())
      await this.audit.write(makeAuditEvent({ actor, action: plan.request.action, status: 'succeeded', environment: plan.environment, target: plan.request.target, planId, ...(approvalId ? { approvalId } : {}), reason: plan.request.reason, detail: { diffCount: plan.diff.length } }))
      return result
    } catch (error) {
      await this.store.failPlan(plan.id, plan.digest)
      await this.audit.write(makeAuditEvent({ actor, action: plan.request.action, status: error instanceof PlugloadError ? 'rejected' : 'failed', environment: plan.environment, target: plan.request.target, planId, ...(approvalId ? { approvalId } : {}), reason: error instanceof Error ? error.message : String(error) }))
      throw error
    }
  }

  private async requirePlan(id: string) {
    const plan = await this.store.getPlan(id)
    if (!plan) throw new PlugloadError('This operation plan does not exist.', 'PLAN_NOT_FOUND', 'Create a new preview and use its plan ID.')
    if (plan.state !== 'applied' && new Date(plan.expiresAt) <= this.now()) throw new PlugloadError('This operation plan has expired.', 'PLAN_EXPIRED', 'Create a fresh preview so it uses current content and schema.')
    return plan
  }

  async getPlan(id: string) { return this.requirePlan(id) }

  private async requireApproval(plan: OperationPlan, id?: string) {
    if (!id) throw new PlugloadError('Explicit approval is required for this operation.', 'APPROVAL_REQUIRED', `Approve plan ${plan.id} after reviewing its diff, then pass the approval ID.`)
    const approval = await this.store.getApproval(id)
    if (!approval || approval.planId !== plan.id || approval.planDigest !== plan.digest || approval.environment !== plan.environment || approval.action !== plan.request.action) throw new PlugloadError('The approval is missing or belongs to another plan.', 'INVALID_APPROVAL', 'Approve this exact plan and use the returned approval ID.')
    if (approval.consumedAt) throw new PlugloadError('This approval has already been used.', 'APPROVAL_ALREADY_USED', 'Create and independently approve a fresh plan.')
    if (new Date(approval.expiresAt) <= this.now()) throw new PlugloadError('The approval has expired.', 'APPROVAL_EXPIRED', 'Review and approve the current plan again.')
    const expected = signApproval({ id: approval.id, planId: approval.planId, approvedBy: approval.approvedBy, approvedAt: approval.approvedAt, expiresAt: approval.expiresAt, confirmation: approval.confirmation, planDigest: approval.planDigest, environment: approval.environment, action: approval.action }, this.requireApprovalSecret())
    if (!safeEqual(approval.signature, expected)) throw new PlugloadError('The approval signature is invalid.', 'INVALID_APPROVAL_SIGNATURE', 'Create a fresh approval through the trusted Plugload endpoint.')
    return approval
  }

  private requireApprovalSecret() {
    const secret = this.options.approvalSigningSecret
    if (!secret || secret.length < 32) throw new PlugloadError('Approval signing is not configured securely.', 'APPROVAL_SIGNING_NOT_CONFIGURED', 'Set a server-only approval signing secret of at least 32 characters.')
    return secret
  }

  private verifyPlanDigest(plan: OperationPlan) {
    if (!safeEqual(plan.digest, digestForPlan(plan))) throw new PlugloadError('The stored operation plan was modified after preview.', 'PLAN_INTEGRITY_FAILED', 'Do not apply it. Inspect storage and create a fresh plan.')
  }
}

export function approvalConfirmation(plan: Pick<OperationPlan, 'id' | 'digest'>) { return `APPROVE ${plan.id} ${plan.digest.slice(0, 12)}` }

function digestForPlan(plan: Omit<OperationPlan, 'digest' | 'state' | 'appliedAt' | 'result'> | OperationPlan) {
  const value = plan as OperationPlan
  const binding = {
    id: value.id,
    createdAt: value.createdAt,
    expiresAt: value.expiresAt,
    environment: value.environment,
    request: value.request,
    before: value.before,
    after: value.after,
    diff: value.diff,
    baselineHash: value.baselineHash,
    ...(value.schemaHash ? { schemaHash: value.schemaHash } : {}),
    approvalRequired: value.approvalRequired,
    approvalReasons: value.approvalReasons,
    risk: value.risk,
    summary: value.summary,
  }
  return contentHash(binding as unknown as JsonValue)
}

function signApproval(approval: Omit<ApprovalReceipt, 'signature' | 'consumedAt'>, secret: string) {
  return createHmac('sha256', secret).update(JSON.stringify(approval)).digest('hex')
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
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
