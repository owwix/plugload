import { describe, expect, it } from 'vitest'
import { MemoryAuditSink } from './audit.js'
import { OperationEngine } from './engine.js'
import type { ContentAdapter, JsonValue, OperationPlan } from './types.js'

class FakeAdapter implements ContentAdapter {
  value: JsonValue | undefined = { id: '1', title: 'Before', _status: 'draft' }
  async read() { return structuredClone(this.value) }
  async validate() {}
  async execute(plan: OperationPlan) { this.value = structuredClone(plan.after); return this.value }
}

const request = { action: 'update' as const, target: { kind: 'collection' as const, slug: 'posts', id: '1' }, data: { title: 'After' }, reason: 'Fix headline', actor: 'codex' }

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
    const engine = new OperationEngine(new FakeAdapter(), { environment: 'production' })
    const plan = await engine.plan(request)
    await expect(engine.apply(plan.id, 'codex')).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' })
    const approval = await engine.approve(plan.id, 'alex', `APPROVE ${plan.id}`)
    await expect(engine.apply(plan.id, 'codex', approval.id)).resolves.toMatchObject({ title: 'After' })
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
})
