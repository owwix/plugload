import { PlugloadError, inspectPayloadConfig, type ContentAdapter, type ContentTarget, type JsonObject, type JsonValue, type OperationAction, type OperationPlan, type OperationRequest } from '@plugload/core'

export class PayloadLocalAdapter implements ContentAdapter {
  constructor(private readonly req: any) {}

  async read(target: ContentTarget, request?: OperationRequest): Promise<JsonValue | undefined> {
    const common = { req: this.req, overrideAccess: false, ...(target.locale ? { locale: target.locale } : {}) }
    if (request?.action === 'bulk-update') {
      const ids = request.ids ?? []
      return Promise.all(ids.map((id) => this.req.payload.findByID({ collection: target.slug, id, ...common }))) as Promise<JsonValue>
    }
    if (target.kind === 'global') return this.req.payload.findGlobal({ slug: target.slug, ...common })
    if (!target.id) throw new PlugloadError('A document ID is required.', 'DOCUMENT_ID_REQUIRED', `Provide an ID for collection ${target.slug}.`)
    return this.req.payload.findByID({ collection: target.slug, id: target.id, draft: true, ...common })
  }

  async preview(request: OperationRequest, before: JsonValue | undefined): Promise<JsonValue | undefined> {
    if (request.action === 'delete') return undefined
    if (request.action === 'rollback') {
      if (!request.versionId) throw new PlugloadError('Rollback requires a version ID.', 'VERSION_ID_REQUIRED', 'Inspect the available versions and choose one to restore.')
      const version = await this.req.payload.findVersionByID({ collection: request.target.slug, id: request.versionId, req: this.req, overrideAccess: false })
      return version?.version ?? version
    }
    if (request.action === 'bulk-update') return (before as JsonValue[]).map((item) => ({ ...(item as JsonObject), ...(request.data ?? {}) }))
    if (request.action === 'publish') return { ...(before as JsonObject), ...(request.data ?? {}), _status: 'published' }
    if (request.action === 'save-draft' || request.action === 'submit-review') return { ...(before as JsonObject), ...(request.data ?? {}), _status: 'draft' }
    return request.action === 'create' ? request.data : { ...(before as JsonObject), ...(request.data ?? {}) }
  }

  async validate(target: ContentTarget, value: JsonValue | undefined, action: OperationAction): Promise<void> {
    if (action === 'delete') return
    const snapshot = inspectPayloadConfig(this.req.payload.config)
    const schema = (target.kind === 'collection' ? snapshot.collections : snapshot.globals).find((item) => item.slug === target.slug)
    if (!schema) throw new PlugloadError(`Payload has no ${target.kind} named ${target.slug}.`, 'SCHEMA_TARGET_NOT_FOUND', 'Inspect the schema and use an exposed slug.')
    if (value && !Array.isArray(value) && typeof value === 'object') {
      const missing = schema.fields.filter((field) => field.required && !field.virtual && (value as JsonObject)[field.name] == null).map((field) => field.name)
      if (missing.length) throw new PlugloadError('The proposed content is missing required fields.', 'VALIDATION_FAILED', `Provide values for: ${missing.join(', ')}`, { missing })
    }
  }

  async execute(plan: OperationPlan): Promise<JsonValue | undefined> {
    const { request } = plan
    const target = request.target
    const common = { req: this.req, overrideAccess: false, ...(target.locale ? { locale: target.locale } : {}) }
    if (request.action === 'create') return this.req.payload.create({ collection: target.slug, data: request.data, draft: true, ...common })
    if (request.action === 'delete') {
      if (!target.id) throw new PlugloadError('Delete requires a document ID.', 'DOCUMENT_ID_REQUIRED', 'Provide the exact document ID.')
      return this.req.payload.delete({ collection: target.slug, id: target.id, ...common })
    }
    if (request.action === 'rollback') {
      const payload = this.req.payload as any
      if (typeof payload.restoreVersion !== 'function') throw new PlugloadError('This Payload version does not expose restoreVersion.', 'ROLLBACK_UNSUPPORTED', 'Use a compatible Payload version or restore the selected version through Payload Admin.')
      return payload.restoreVersion({ collection: target.slug, id: request.versionId, ...common })
    }
    if (request.action === 'bulk-update') {
      return this.req.payload.update({ collection: target.slug, where: { id: { in: request.ids ?? [] } }, data: request.data, draft: true, ...common })
    }
    if (request.action === 'promote') {
      const data = request.data ?? {}
      if (target.kind === 'global') return this.req.payload.updateGlobal({ slug: target.slug, data, draft: true, ...common })
      if (target.id) return this.req.payload.update({ collection: target.slug, id: target.id, data, draft: true, ...common })
      return this.req.payload.create({ collection: target.slug, data, draft: true, ...common })
    }
    const data = request.action === 'publish' ? { ...(request.data ?? {}), _status: 'published' } : { ...(request.data ?? {}), _status: 'draft' }
    if (target.kind === 'global') return this.req.payload.updateGlobal({ slug: target.slug, data, draft: request.action !== 'publish', ...common })
    if (!target.id) throw new PlugloadError('Update requires a document ID.', 'DOCUMENT_ID_REQUIRED', 'Provide the exact document ID.')
    return this.req.payload.update({ collection: target.slug, id: target.id, data, draft: request.action !== 'publish', ...common })
  }
}
