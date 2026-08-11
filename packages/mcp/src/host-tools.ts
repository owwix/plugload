import { OperationEngine, approvalConfirmation, asHumanError, inspectPayloadConfig, PlugloadError, verifyAuditChain, type EnvironmentKind, type OperationPlan, type OperationRequest } from '@plugload/core'
import { z } from 'zod'
import { PayloadLocalAdapter } from './payload-adapter.js'
import { PayloadAuditSink, PayloadOperationStore } from './payload-persistence.js'

export interface PlugloadHostOptions {
  environment: EnvironmentKind
  projectName?: string
  approvalSigningSecret?: string
  canApprove?: (context: { req: any; plan: OperationPlan }) => boolean | Promise<boolean>
  collections?: string[]
  globals?: string[]
}

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
  return new OperationEngine(new PayloadLocalAdapter(req, { ...(options.collections ? { collections: options.collections } : {}), ...(options.globals ? { globals: options.globals } : {}) }), { environment: options.environment, store: new PayloadOperationStore(req), audit: new PayloadAuditSink(req), ...(options.approvalSigningSecret ? { approvalSigningSecret: options.approvalSigningSecret } : {}) })
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
    { name: 'plugload_inspect_schema', description: 'Inspect explicitly exposed Payload collections, globals, visible fields, relationships, validation, localization, drafts, versions, and configured access rules. Read-only.', parameters: z.object({}), handler: safe(async (_args, req) => { const snapshot = inspectPayloadConfig(req.payload.config); return { ...snapshot, collections: snapshot.collections.filter((item) => options.collections?.includes(item.slug)).map(visibleSchema), globals: snapshot.globals.filter((item) => options.globals?.includes(item.slug)).map(visibleSchema) } }) },
    { name: 'plugload_plan_operation', description: 'Create a schema-aware content change preview. Returns the exact before/after diff and whether explicit approval is required. Does not mutate content.', parameters: requestSchema, handler: safe(async (args, req) => { const plan = await engine(req, options).plan({ ...(args as OperationRequest), actor: actor(req) }); return { ...plan, ...(plan.approvalRequired ? { approvalConfirmation: approvalConfirmation(plan) } : {}) } }) },
    { name: 'plugload_approve_operation', description: 'Record approval from a separately authenticated, authorized Payload user. Approval is bound to the exact plan digest and can be used once.', parameters: z.object({ planId: z.string().uuid(), confirmation: z.string().min(1) }), handler: safe(async (args, req) => {
      const operationEngine = engine(req, options)
      const plan = await operationEngine.getPlan(args.planId)
      if (!options.canApprove || !await options.canApprove({ req, plan })) throw new PlugloadError('This Payload user is not authorized to approve operations.', 'APPROVER_NOT_AUTHORIZED', 'Use the separately authenticated approval connection configured by the project owner.')
      return operationEngine.approve(args.planId, actor(req), args.confirmation)
    }) },
    { name: 'plugload_apply_operation', description: 'Apply a previously previewed plan. Refuses stale content and requires approval for publishing, deletion, bulk changes, rollback, promotion, and production mutations.', parameters: z.object({ planId: z.string().uuid(), actor: z.string().optional(), approvalId: z.string().uuid().optional() }), handler: safe(async (args, req) => engine(req, options).apply(args.planId, actor(req), args.approvalId)) },
    { name: 'plugload_audit_recent', description: 'Return recent Plugload content-operation audit events. Read-only.', parameters: z.object({ limit: z.number().int().min(1).max(200).default(50) }), handler: safe(async (args, req) => new PayloadAuditSink(req).recent(args.limit)) },
    { name: 'plugload_audit_verify', description: 'Verify the tamper-evident hash chain for the complete Plugload audit history. Read-only.', parameters: z.object({ limit: z.number().int().min(1).max(10_000).default(10_000) }), handler: safe(async (args, req) => { const events = await new PayloadAuditSink(req).recent(args.limit); return { checked: events.length, ...verifyAuditChain(events.reverse()) } }) },
  ]
}

function visibleSchema<T extends { fields: any[] }>(schema: T): T {
  const fields = schema.fields.filter((field) => !field.hidden && field.access?.read !== 'denied').map((field) => ({
    ...field,
    ...(field.fields ? { fields: visibleSchema({ fields: field.fields }).fields } : {}),
    ...(field.blocks ? { blocks: field.blocks.map((block: any) => ({ ...block, fields: visibleSchema({ fields: block.fields }).fields })) } : {}),
  }))
  return { ...schema, fields }
}

export function createPlugloadMcpResources(options: PlugloadHostOptions): any[] {
  return [{ name: 'plugloadSafetyPolicy', title: 'Plugload content safety policy', description: 'Mandatory workflow and approval policy for this Payload project.', uri: 'plugload://policy', mimeType: 'text/markdown', handler: async (uri: URL) => ({ contents: [{ uri: uri.href, text: `# Plugload policy\n\nEnvironment: **${options.environment}**.\n\nAlways inspect schema, read current content, create a plan, show the diff, obtain required approval, then apply. Never bypass Payload access controls.` }] }) }]
}
