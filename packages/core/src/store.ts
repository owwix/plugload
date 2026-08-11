import type { ApprovalReceipt, OperationPlan, OperationStore } from './types.js'

export class MemoryOperationStore implements OperationStore {
  private readonly plans = new Map<string, OperationPlan>()
  private readonly approvals = new Map<string, ApprovalReceipt>()

  async savePlan(plan: OperationPlan) { this.plans.set(plan.id, structuredClone(plan)) }
  async getPlan(id: string) { const value = this.plans.get(id); return value ? structuredClone(value) : undefined }
  async saveApproval(approval: ApprovalReceipt) { this.approvals.set(approval.id, structuredClone(approval)) }
  async getApproval(id: string) { const value = this.approvals.get(id); return value ? structuredClone(value) : undefined }
}
