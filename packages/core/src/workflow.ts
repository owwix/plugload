import type { JsonObject, OperationRequest } from './types.js'

type Base = Omit<OperationRequest, 'action' | 'data'> & { data?: JsonObject }

export const workflow = {
  draft(input: Base): OperationRequest { return { ...input, action: 'save-draft' } },
  review(input: Base): OperationRequest { return { ...input, action: 'submit-review', data: { ...(input.data ?? {}), plugloadWorkflow: 'review' } } },
  publish(input: Base): OperationRequest { return { ...input, action: 'publish' } },
  rollback(input: Base & { versionId: string }): OperationRequest { return { ...input, action: 'rollback' } },
  promote(input: Base & { sourceEnvironment: string; destinationEnvironment: string }): OperationRequest { return { ...input, action: 'promote' } },
}
