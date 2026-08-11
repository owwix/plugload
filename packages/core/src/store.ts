import type { ApprovalReceipt, JsonValue, OperationPlan, OperationStore } from './types.js'

export class MemoryOperationStore implements OperationStore {
  private readonly plans = new Map<string, OperationPlan>()
  private readonly approvals = new Map<string, ApprovalReceipt>()

  async savePlan(plan: OperationPlan) { this.plans.set(plan.id, structuredClone(plan)) }
  async getPlan(id: string) { const value = this.plans.get(id); return value ? structuredClone(value) : undefined }
  async saveApproval(approval: ApprovalReceipt) { this.approvals.set(approval.id, structuredClone(approval)) }
  async getApproval(id: string) { const value = this.approvals.get(id); return value ? structuredClone(value) : undefined }
  async consumeApproval(id: string, planId: string, planDigest: string, consumedAt: string) {
    const value = this.approvals.get(id)
    if (!value || value.planId !== planId || value.planDigest !== planDigest || value.consumedAt) return undefined
    const consumed = { ...value, consumedAt }
    this.approvals.set(id, consumed)
    return structuredClone(consumed)
  }
  async claimPlan(id: string, digest: string) {
    const plan = this.plans.get(id)
    if (!plan || plan.digest !== digest) return 'missing' as const
    if (plan.state === 'applied') return 'applied' as const
    if (plan.state !== 'pending') return 'busy' as const
    this.plans.set(id, { ...plan, state: 'applying' })
    return 'claimed' as const
  }
  async completePlan(id: string, digest: string, result: JsonValue | undefined, appliedAt: string) {
    const plan = this.plans.get(id)
    if (!plan || plan.digest !== digest || plan.state !== 'applying') throw new Error('Plan completion state mismatch')
    this.plans.set(id, { ...plan, state: 'applied', appliedAt, ...(result === undefined ? {} : { result: structuredClone(result) }) })
  }
  async failPlan(id: string, digest: string) {
    const plan = this.plans.get(id)
    if (plan?.digest === digest && plan.state === 'applying') this.plans.set(id, { ...plan, state: 'failed' })
  }
}
