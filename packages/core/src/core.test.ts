import { describe, expect, it } from 'vitest'
import { MemoryAuditSink } from './audit.js'
import { approvalConfirmation, OperationEngine } from './engine.js'
import type { ContentAdapter, JsonValue, OperationPlan } from './types.js'

class FakeAdapter implements ContentAdapter {
  value: JsonValue | undefined = { id: '1', title: 'Before', _status: 'draft' }
  executions = 0
  schemaVersion = 'schema-v1'
  async read() { return structuredClone(this.value) }
  async validate() {}
  async schemaFingerprint() { return this.schemaVersion }
  async execute(plan: OperationPlan) { this.executions += 1; this.value = structuredClone(plan.after); return this.value }
}

const request = { action: 'update' as const, target: { kind: 'collection' as const, slug: 'posts', id: '1' }, data: { title: 'After' }, reason: 'Fix headline', actor: 'codex' }
const approvalSigningSecret = 'test-only-approval-signing-secret-at-least-32-characters'

describe('OperationEngine', () => {
  it('previews a field-level diff and applies a non-production update', async () => {
    const adapter = new FakeAdapter()
    const engine = new OperationEngine(adapter, { environment: 'staging' })
    const plan = await engine.plan(request)
    expect(plan.diff).toEqual([{ path: '$.title', kind: 'change', before: 'Before', after: 'After' }])
    expect(plan.approvalRequired).toBe(false)
    await engine.apply(plan.id, 'codex')
    expect(adapter.value).toMatchObject({ title: 'After' })
  })

  it('requires exact explicit approval for production updates', async () => {
    const engine = new OperationEngine(new FakeAdapter(), { environment: 'production', approvalSigningSecret })
    const plan = await engine.plan(request)
    await expect(engine.apply(plan.id, 'codex')).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' })
    const approval = await engine.approve(plan.id, 'alex', approvalConfirmation(plan))
    await expect(engine.apply(plan.id, 'codex', approval.id)).resolves.toMatchObject({ title: 'After' })
  })

  it('forbids self-approval', async () => {
    const engine = new OperationEngine(new FakeAdapter(), { environment: 'production', approvalSigningSecret })
    const plan = await engine.plan(request)
    await expect(engine.approve(plan.id, request.actor, approvalConfirmation(plan))).rejects.toMatchObject({ code: 'SELF_APPROVAL_FORBIDDEN' })
  })

  it('binds approval confirmation to the plan digest', async () => {
    const engine = new OperationEngine(new FakeAdapter(), { environment: 'production', approvalSigningSecret })
    const plan = await engine.plan(request)
    await expect(engine.approve(plan.id, 'alex', `APPROVE ${plan.id}`)).rejects.toMatchObject({ code: 'APPROVAL_CONFIRMATION_MISMATCH' })
  })

  it('requires a server-only signing secret for approval', async () => {
    const engine = new OperationEngine(new FakeAdapter(), { environment: 'production' })
    const plan = await engine.plan(request)
    await expect(engine.approve(plan.id, 'alex', approvalConfirmation(plan))).rejects.toMatchObject({ code: 'APPROVAL_SIGNING_NOT_CONFIGURED' })
  })

  it('applies a plan once and returns the stored result on retries', async () => {
    const adapter = new FakeAdapter()
    const engine = new OperationEngine(adapter, { environment: 'production', approvalSigningSecret })
    const plan = await engine.plan(request)
    const approval = await engine.approve(plan.id, 'alex', approvalConfirmation(plan))
    const first = await engine.apply(plan.id, 'codex', approval.id)
    const retry = await engine.apply(plan.id, 'codex', approval.id)
    expect(retry).toEqual(first)
    expect(adapter.executions).toBe(1)
  })

  it('refuses stale plans and audits the plan', async () => {
    const adapter = new FakeAdapter()
    const audit = new MemoryAuditSink()
    const engine = new OperationEngine(adapter, { environment: 'staging', audit })
    const plan = await engine.plan(request)
    adapter.value = { id: '1', title: 'Someone else edited it' }
    await expect(engine.apply(plan.id, 'codex')).rejects.toMatchObject({ code: 'STALE_PLAN' })
    expect(audit.events[0]?.status).toBe('planned')
  })

  it('refuses a plan after schema drift', async () => {
    const adapter = new FakeAdapter()
    const engine = new OperationEngine(adapter, { environment: 'staging' })
    const plan = await engine.plan(request)
    adapter.schemaVersion = 'schema-v2'
    await expect(engine.apply(plan.id, 'codex')).rejects.toMatchObject({ code: 'STALE_SCHEMA' })
  })

  it('rejects invalid promotion environment bindings', async () => {
    const engine = new OperationEngine(new FakeAdapter(), { environment: 'production' })
    await expect(engine.plan({ ...request, action: 'promote', sourceEnvironment: 'staging', destinationEnvironment: 'staging' })).rejects.toMatchObject({ code: 'PROMOTION_ENVIRONMENT_MISMATCH' })
  })

  it('rejects empty or duplicate bulk identifiers', async () => {
    const engine = new OperationEngine(new FakeAdapter(), { environment: 'staging' })
    await expect(engine.plan({ ...request, action: 'bulk-update', ids: [] })).rejects.toMatchObject({ code: 'INVALID_BULK_IDS' })
    await expect(engine.plan({ ...request, action: 'bulk-update', ids: ['1', '1'] })).rejects.toMatchObject({ code: 'INVALID_BULK_IDS' })
  })
})
