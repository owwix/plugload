#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { asHumanError } from '@plugload/core'
import { loadConfig, resultValue, selectProject, withPayloadClient } from '@plugload/mcp'

const [, , command, subcommand, ...rest] = process.argv
const flags = parseFlags(rest)

async function main() {
  if (!command || command === 'help' || flags.help) return printHelp()
  const configPath = typeof flags.config === 'string' ? flags.config : undefined
  const config = await loadConfig(configPath)

  if (command === 'config' && subcommand === 'validate') {
    return output({ ok: true, projects: config.projects.map(({ name, url, environment, default: isDefault }) => ({ name, url, environment, default: Boolean(isDefault) })) })
  }

  const project = selectProject(config, typeof flags.project === 'string' ? flags.project : undefined)
  if (command === 'connection' && subcommand === 'test') {
    return withPayloadClient(project, async (client) => {
      const tools = await client.listTools()
      output({ ok: true, project: project.name, environment: project.environment, toolCount: tools.tools.length, hostAdapterInstalled: tools.tools.some((tool) => tool.name === 'plugload_plan_operation') })
    })
  }
  if (command === 'schema' && subcommand === 'inspect') {
    return withPayloadClient(project, async (client) => output(resultValue(await client.callTool({ name: 'plugload_inspect_schema', arguments: {} }))))
  }
  if (command === 'audit' && subcommand === 'recent') {
    const limit = typeof flags.limit === 'string' ? Number.parseInt(flags.limit, 10) : 20
    return withPayloadClient(project, async (client) => output(resultValue(await client.callTool({ name: 'plugload_audit_recent', arguments: { limit } }))))
  }
  if (command === 'preview' && subcommand === 'operation') {
    const request = await readJsonFlag(flags.file, 'preview operation requires --file <request.json>')
    return withPayloadClient(project, async (client) => output(resultValue(await client.callTool({ name: 'plugload_plan_operation', arguments: request as Record<string, unknown> }))))
  }
  if (command === 'approve' && subcommand === 'operation') {
    requireString(flags.plan, '--plan is required')
    requireString(flags.by, '--by is required')
    requireString(flags.confirm, '--confirm is required')
    return withPayloadClient(project, async (client) => output(resultValue(await client.callTool({ name: 'plugload_approve_operation', arguments: { planId: flags.plan, approvedBy: flags.by, confirmation: flags.confirm } }))))
  }
  if (command === 'apply' && subcommand === 'operation') {
    requireString(flags.plan, '--plan is required')
    requireString(flags.actor, '--actor is required')
    return withPayloadClient(project, async (client) => output(resultValue(await client.callTool({ name: 'plugload_apply_operation', arguments: { planId: flags.plan, actor: flags.actor, ...(typeof flags.approval === 'string' ? { approvalId: flags.approval } : {}) } }))))
  }
  throw new Error(`Unknown command: ${command} ${subcommand ?? ''}`)
}

function parseFlags(args: string[]): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {}
  for (let i = 0; i < args.length; i++) {
    const token = args[i]!
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const next = args[i + 1]
    if (next && !next.startsWith('--')) { result[key] = next; i++ } else result[key] = true
  }
  return result
}

async function readJsonFlag(value: string | boolean | undefined, error: string): Promise<unknown> {
  requireString(value, error)
  return JSON.parse(await readFile(value, 'utf8'))
}
function requireString(value: unknown, message: string): asserts value is string { if (typeof value !== 'string') throw new Error(message) }
function output(value: unknown) { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`) }
function printHelp() {
  process.stdout.write(`plugload <command>\n\n  config validate [--config path]\n  connection test [--project name]\n  schema inspect [--project name]\n  audit recent [--limit 20] [--project name]\n  preview operation --file request.json [--project name]\n  approve operation --plan id --by person --confirm "APPROVE <id>"\n  apply operation --plan id --actor name [--approval id]\n\nUse action "promote" in an operation file after reading the source project; the selected --project is always the destination.\n`)
}

main().catch((error) => { output(asHumanError(error).toJSON()); process.exitCode = 1 })
