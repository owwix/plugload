import { OperationEngine, asHumanError, inspectPayloadConfig, type EnvironmentKind, type OperationRequest } from '@plugload/core'
import { z } from 'zod'
import { PayloadLocalAdapter } from './payload-adapter.js'
import { PayloadAuditSink, PayloadOperationStore } from './payload-persistence.js'

export interface PlugloadHostOptions { environment: EnvironmentKind; projectName?: string }

const targetSchema = z.object({ kind: z.enum(['collection', 'global']), slug: z.string().min(1), id: z.string().optional(), locale: z.string().optional() })
const requestSchema = z.object({
  action: z.enum(['create', 'update', 'delete', 'save-draft', 'submit-review', 'publish', 'rollback', 'promote', 'bulk-update']),
  target: targetSchema,
  data: z.record(z.any()).optional(),
  ids: z.array(z.string()).max(100).optional(),
  versionId: z.string().optional(),
  sourceEnvironment: z.string().optional(),
  destinationEnvironment: z.string().optional(),
  reason: z.string().min(3),
  actor: z.string().min(1).optional(),
})

function engine(req: any, options: PlugloadHostOptions) {
  return new OperationEngine(new PayloadLocalAdapter(req), { environment: options.environment, store: new PayloadOperationStore(req), audit: new PayloadAuditSink(req) })
}

function actor(req: any): string { return String(req.user?.email ?? req.user?.id ?? 'authenticated-mcp-user') }

function response(value: unknown) {
  const content = [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }]
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? { content, structuredContent: value as Record<string, unknown> }
    : { content }
}

function safe(handler: (args: any, req: any) => Promise<unknown>) {
  return async (args: any, req: any) => {
    try { return response(await handler(args, req)) }
    catch (error) { const human = asHumanError(error); return { isError: true, ...response(human.toJSON()) } }
  }
}

export function createPlugloadMcpTools(options: PlugloadHostOptions): any[] {
  return [
    { name: 'plugload_inspect_schema', description: 'Inspect Payload collections, globals, fields, relationships, validation, localization, drafts, versions, and configured access rules. Read-only.', parameters: z.object({}), handler: safe(async (_args, req) => inspectPayloadConfig(req.payload.config)) },
    { name: 'plugload_plan_operation', description: 'Create a schema-aware content change preview. Returns the exact before/after diff and whether explicit approval is required. Does not mutate content.', parameters: requestSchema, handler: safe(async (args, req) => engine(req, options).plan({ ...(args as OperationRequest), actor: actor(req) })) },
    { name: 'plugload_approve_operation', description: 'Record explicit human approval for a reviewed operation plan. Confirmation must exactly match APPROVE <planId>.', parameters: z.object({ planId: z.string().uuid(), approvedBy: z.string().optional(), confirmation: z.string().min(1) }), handler: safe(async (args, req) => engine(req, options).approve(args.planId, actor(req), args.confirmation)) },
    { name: 'plugload_apply_operation', description: 'Apply a previously previewed plan. Refuses stale content and requires approval for publishing, deletion, bulk changes, rollback, promotion, and production mutations.', parameters: z.object({ planId: z.string().uuid(), actor: z.string().optional(), approvalId: z.string().uuid().optional() }), handler: safe(async (args, req) => engine(req, options).apply(args.planId, actor(req), args.approvalId)) },
    { name: 'plugload_audit_recent', description: 'Return recent Plugload content-operation audit events. Read-only.', parameters: z.object({ limit: z.number().int().min(1).max(200).default(50) }), handler: safe(async (args, req) => new PayloadAuditSink(req).recent(args.limit)) },
  ]
}

export function createPlugloadMcpResources(options: PlugloadHostOptions): any[] {
  return [{ name: 'plugloadSafetyPolicy', title: 'Plugload content safety policy', description: 'Mandatory workflow and approval policy for this Payload project.', uri: 'plugload://policy', mimeType: 'text/markdown', handler: async (uri: URL) => ({ contents: [{ uri: uri.href, text: `# Plugload policy\n\nEnvironment: **${options.environment}**.\n\nAlways inspect schema, read current content, create a plan, show the diff, obtain required approval, then apply. Never bypass Payload access controls.` }] }) }]
}
