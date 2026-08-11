export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }
export type JsonObject = { [key: string]: JsonValue }

export type EnvironmentKind = 'development' | 'preview' | 'staging' | 'production'
export type TargetKind = 'collection' | 'global'
export type OperationAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'save-draft'
  | 'submit-review'
  | 'publish'
  | 'rollback'
  | 'promote'
  | 'bulk-update'

export interface ContentTarget {
  kind: TargetKind
  slug: string
  id?: string
  locale?: string
}

export interface OperationRequest {
  action: OperationAction
  target: ContentTarget
  data?: JsonObject
  ids?: string[]
  versionId?: string
  sourceEnvironment?: string
  destinationEnvironment?: string
  reason: string
  actor: string
}

export interface DiffEntry {
  path: string
  kind: 'add' | 'remove' | 'change'
  before?: JsonValue
  after?: JsonValue
}

export interface OperationPlan {
  id: string
  createdAt: string
  expiresAt: string
  environment: EnvironmentKind
  request: OperationRequest
  before: JsonValue | undefined
  after: JsonValue | undefined
  diff: DiffEntry[]
  baselineHash: string
  schemaHash?: string
  approvalRequired: boolean
  approvalReasons: string[]
  risk: 'low' | 'medium' | 'high' | 'critical'
  summary: string
  digest: string
  state: 'pending' | 'applying' | 'applied' | 'failed'
  appliedAt?: string
  result?: JsonValue
}

export interface ApprovalReceipt {
  id: string
  planId: string
  approvedBy: string
  approvedAt: string
  expiresAt: string
  confirmation: string
  planDigest: string
  environment: EnvironmentKind
  action: OperationAction
  signature: string
  consumedAt?: string
}

export interface AuditEvent {
  id: string
  timestamp: string
  actor: string
  action: string
  status: 'planned' | 'approved' | 'executing' | 'succeeded' | 'rejected' | 'failed' | 'replayed'
  environment: EnvironmentKind
  target: ContentTarget
  planId?: string
  approvalId?: string
  reason?: string
  detail?: JsonObject
  previousHash?: string
  integrityHash?: string
}

export interface FieldSchema {
  name: string
  type: string
  label?: string
  required: boolean
  localized: boolean
  unique: boolean
  virtual: boolean
  relationTo?: string[]
  options?: JsonValue
  validation: string[]
  fields?: FieldSchema[]
  blocks?: Array<{ slug: string; fields: FieldSchema[] }>
  hasMany: boolean
  hidden: boolean
  access: Record<string, 'allowed' | 'denied' | 'dynamic' | 'unspecified'>
}

export interface ContentTypeSchema {
  kind: TargetKind
  slug: string
  labels?: JsonValue
  versions: boolean
  drafts: boolean
  fields: FieldSchema[]
  access: Record<string, 'allowed' | 'denied' | 'dynamic' | 'unspecified'>
}

export interface PayloadSchemaSnapshot {
  generatedAt: string
  localization: {
    enabled: boolean
    locales: string[]
    defaultLocale?: string
    fallback: boolean
  }
  collections: ContentTypeSchema[]
  globals: ContentTypeSchema[]
}

export interface ContentAdapter {
  read(target: ContentTarget, request?: OperationRequest): Promise<JsonValue | undefined>
  preview?(request: OperationRequest, before: JsonValue | undefined): Promise<JsonValue | undefined>
  validate(target: ContentTarget, value: JsonValue | undefined, action: OperationAction): Promise<void>
  execute(plan: OperationPlan): Promise<JsonValue | undefined>
  schemaFingerprint?(target: ContentTarget): Promise<string>
}

export interface AuditSink {
  write(event: AuditEvent): Promise<void>
  recent?(limit: number): Promise<AuditEvent[]>
}

export interface OperationStore {
  savePlan(plan: OperationPlan): Promise<void>
  getPlan(id: string): Promise<OperationPlan | undefined>
  saveApproval(approval: ApprovalReceipt): Promise<void>
  getApproval(id: string): Promise<ApprovalReceipt | undefined>
  consumeApproval(id: string, planId: string, planDigest: string, consumedAt: string): Promise<ApprovalReceipt | undefined>
  claimPlan(id: string, digest: string): Promise<'claimed' | 'applied' | 'busy' | 'missing'>
  completePlan(id: string, digest: string, result: JsonValue | undefined, appliedAt: string): Promise<void>
  failPlan(id: string, digest: string): Promise<void>
}
