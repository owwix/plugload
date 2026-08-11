#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { asHumanError } from '@plugload/core'
import { z } from 'zod'
import { loadConfig, selectProject } from './config.js'
import { resultValue, withPayloadClient } from './remote.js'

const config = await loadConfig()
const server = new McpServer({ name: 'plugload', version: '0.1.0' })

function text(value: unknown) { return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] } }
function guarded(handler: (args: any) => Promise<unknown>) {
  return async (args: any) => {
    try { return text(await handler(args)) }
    catch (error) { return { isError: true, ...text(asHumanError(error).toJSON()) } }
  }
}

server.registerTool('plugload_projects', { title: 'List Payload projects', description: 'List configured Payload projects and environments without exposing credentials.', inputSchema: {} }, guarded(async () => config.projects.map(({ name, url, environment, default: isDefault }) => ({ name, url, environment, default: Boolean(isDefault) }))))

server.registerTool('plugload_connection_test', { title: 'Test Payload MCP connection', description: 'Connect to a configured official Payload MCP endpoint and report its tools. Read-only.', inputSchema: { project: z.string().optional() } }, guarded(async ({ project }) => {
  const selected = selectProject(config, project)
  return withPayloadClient(selected, async (client) => {
    const tools = await client.listTools()
    return { ok: true, project: selected.name, environment: selected.environment, toolCount: tools.tools.length, plugloadHostTools: tools.tools.filter((tool) => tool.name.startsWith('plugload_')).map((tool) => tool.name) }
  })
}))

server.registerTool('plugload_schema_inspect', { title: 'Inspect Payload schema', description: 'Return the Plugload schema snapshot, or a read-only summary of official Payload MCP tools when the host adapter is absent.', inputSchema: { project: z.string().optional() } }, guarded(async ({ project }) => {
  const selected = selectProject(config, project)
  return withPayloadClient(selected, async (client) => {
    const tools = await client.listTools()
    if (tools.tools.some((tool) => tool.name === 'plugload_inspect_schema')) return resultValue(await client.callTool({ name: 'plugload_inspect_schema', arguments: {} }))
    return { degraded: true, message: 'Install createPlugloadMcpTools in the Payload app for field-level schema discovery.', officialTools: tools.tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) }
  })
}))

server.registerTool('plugload_content_read', {
  title: 'Read Payload content',
  description: 'Read content through the official Payload MCP find tool, preserving the API key owner access controls.',
  inputSchema: { project: z.string().optional(), kind: z.enum(['collection', 'global']), slug: z.string(), id: z.string().optional(), locale: z.string().optional(), depth: z.number().int().min(0).max(5).default(1) },
}, guarded(async ({ project, slug, id, locale, depth }) => {
  const selected = selectProject(config, project)
  return withPayloadClient(selected, async (client) => {
    const listed = await client.listTools()
    const normalized = slug.replace(/[^a-z0-9]/gi, '').toLowerCase()
    const tool = listed.tools.find((candidate) => candidate.name.startsWith('find') && candidate.name.slice(4).replace(/[^a-z0-9]/gi, '').toLowerCase() === normalized)
    if (!tool) throw new Error(`No official Payload find tool is enabled for ${slug}.`)
    const args: Record<string, unknown> = { depth }
    if (id) { args.where = JSON.stringify({ id: { equals: id } }); args.limit = 1 }
    if (locale) args.locale = locale
    return resultValue(await client.callTool({ name: tool.name, arguments: args }))
  })
}))

const forwarded: Array<[string, string, string, Record<string, z.ZodTypeAny>]> = [
  ['plugload_operation_plan', 'plugload_plan_operation', 'Preview a schema-aware operation and exact before/after diff without changing content.', { project: z.string().optional(), request: z.record(z.any()) }],
  ['plugload_operation_apply', 'plugload_apply_operation', 'Apply a reviewed plan through the Payload-hosted safety adapter.', { project: z.string().optional(), planId: z.string(), actor: z.string(), approvalId: z.string().optional() }],
  ['plugload_audit_recent', 'plugload_audit_recent', 'Read recent content-operation audit events.', { project: z.string().optional(), limit: z.number().int().min(1).max(200).default(50) }],
  ['plugload_audit_verify', 'plugload_audit_verify', 'Verify the tamper-evident audit hash chain.', { project: z.string().optional(), limit: z.number().int().min(1).max(10_000).default(10_000) }],
]

for (const [localName, upstreamName, description, inputSchema] of forwarded) {
  server.registerTool(localName, { description, inputSchema }, guarded(async (args: any) => {
    const selected = selectProject(config, args.project)
    const upstreamArgs = upstreamName === 'plugload_plan_operation'
      ? args.request
      : Object.fromEntries(Object.entries(args).filter(([key]) => key !== 'project'))
    return withPayloadClient(selected, async (client) => resultValue(await client.callTool({ name: upstreamName, arguments: upstreamArgs })))
  }))
}

await server.connect(new StdioServerTransport())
