import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { approvalConfirmation, OperationEngine, verifyAuditChain } from '@plugload/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildConfig, createLocalReq, getPayload, type Payload, type PayloadRequest } from 'payload'
import { PayloadLocalAdapter } from './payload-adapter.js'
import { createPlugloadCollections, PayloadAuditSink, PayloadOperationStore } from './payload-persistence.js'

const secret = 'integration-approval-signing-secret-at-least-32-characters'
let directory: string
let payload: Payload
let agentReq: PayloadRequest
let approverReq: PayloadRequest
let viewerReq: PayloadRequest
let postId: string

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'plugload-integration-'))
  const config = await buildConfig({
    secret: 'integration-payload-secret-at-least-32-characters',
    db: sqliteAdapter({ client: { url: `file:${join(directory, 'payload.db')}` } }),
    editor: lexicalEditor(),
    collections: [
      {
        slug: 'users',
        auth: true,
        fields: [{ name: 'role', type: 'select', required: true, options: ['agent', 'approver', 'viewer'] }],
      },
      {
        slug: 'posts',
        versions: { drafts: true },
        access: {
          read: ({ req }) => Boolean(req.user),
          create: ({ req }) => req.user?.role === 'agent',
          update: ({ req }) => req.user?.role === 'agent',
          delete: () => false,
          readVersions: ({ req }) => Boolean(req.user),
        },
        fields: [{ name: 'title', type: 'text', required: true }, { name: 'reviewStatus', type: 'select', options: ['draft', 'review', 'approved'], defaultValue: 'draft' }],
      },
      ...createPlugloadCollections(),
    ],
  })
  payload = await getPayload({ config })
  const agent = await payload.create({ collection: 'users', data: { email: 'agent@example.test', password: 'integration-password', role: 'agent' }, overrideAccess: true })
  const approver = await payload.create({ collection: 'users', data: { email: 'approver@example.test', password: 'integration-password', role: 'approver' }, overrideAccess: true })
  const viewer = await payload.create({ collection: 'users', data: { email: 'viewer@example.test', password: 'integration-password', role: 'viewer' }, overrideAccess: true })
  agentReq = await createLocalReq({ user: { ...agent, collection: 'users' } as any }, payload)
  approverReq = await createLocalReq({ user: { ...approver, collection: 'users' } as any }, payload)
  viewerReq = await createLocalReq({ user: { ...viewer, collection: 'users' } as any }, payload)
  const post = await payload.create({ collection: 'posts', data: { title: 'Before' }, draft: true, req: agentReq, overrideAccess: false })
  postId = String(post.id)
})

afterAll(async () => {
  await payload?.destroy()
  if (directory) await rm(directory, { recursive: true, force: true })
})

function engine(req: PayloadRequest) {
  return new OperationEngine(new PayloadLocalAdapter(req, { collections: ['posts'], globals: [] }), {
    environment: 'production',
    approvalSigningSecret: secret,
    store: new PayloadOperationStore(req),
    audit: new PayloadAuditSink(req),
  })
}

describe('Payload integration', () => {
  it('uses separate authenticated users for plan, approval, and one-time apply', async () => {
    const agent = engine(agentReq)
    const plan = await agent.plan({ action: 'update', target: { kind: 'collection', slug: 'posts', id: postId }, data: { title: 'After' }, reason: 'Integration verification', actor: 'agent@example.test' })
    const approval = await engine(approverReq).approve(plan.id, 'approver@example.test', approvalConfirmation(plan))
    await expect(agent.apply(plan.id, 'agent@example.test', approval.id)).resolves.toMatchObject({ title: 'After' })
    await expect(agent.apply(plan.id, 'agent@example.test', approval.id)).resolves.toMatchObject({ title: 'After' })
    const events = await new PayloadAuditSink(approverReq).recent(20)
    expect(events.map((event) => event.status)).toEqual(expect.arrayContaining(['planned', 'approved', 'executing', 'succeeded', 'replayed']))
    expect(verifyAuditChain(events.reverse())).toEqual({ valid: true })
  })

  it('preserves Payload access rules during apply', async () => {
    const post = await payload.create({ collection: 'posts', data: { title: 'Restricted' }, draft: true, req: agentReq, overrideAccess: false })
    const viewer = engine(viewerReq)
    const plan = await viewer.plan({ action: 'update', target: { kind: 'collection', slug: 'posts', id: String(post.id) }, data: { title: 'Forbidden' }, reason: 'Verify access denial', actor: 'viewer@example.test' })
    const approval = await engine(approverReq).approve(plan.id, 'approver@example.test', approvalConfirmation(plan))
    await expect(viewer.apply(plan.id, 'viewer@example.test', approval.id)).rejects.toBeTruthy()
    const unchanged = await payload.findByID({ collection: 'posts', id: post.id, draft: true, overrideAccess: true })
    expect(unchanged.title).toBe('Restricted')
  })

  it('rejects slugs outside the explicit Plugload scope', async () => {
    await expect(new PayloadLocalAdapter(agentReq, { collections: [], globals: [] }).read({ kind: 'collection', slug: 'users', id: '1' })).rejects.toMatchObject({ code: 'TARGET_NOT_EXPOSED' })
  })
})
