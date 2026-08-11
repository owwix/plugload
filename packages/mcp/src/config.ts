import { readFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PlugloadError, type EnvironmentKind } from '@plugload/core'

export interface ProjectConfig {
  name: string
  url: string
  environment: EnvironmentKind
  token?: string
  tokenEnv?: string
  tokenFile?: string
  approvalTokenEnv?: string
  approvalTokenFile?: string
  default?: boolean
}

export interface PlugloadConfig { projects: ProjectConfig[] }

export async function loadConfig(path = process.env.PLUGLOAD_CONFIG ?? './plugload.config.json'): Promise<PlugloadConfig> {
  let parsed: unknown
  try { parsed = JSON.parse(await readFile(resolve(path), 'utf8')) }
  catch (error) { throw new PlugloadError(`Could not read Plugload config at ${resolve(path)}.`, 'CONFIG_UNREADABLE', 'Copy plugload.config.example.json, set tokenEnv, and try again.', error instanceof Error ? error.message : error) }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as any).projects) || !(parsed as any).projects.length) {
    throw new PlugloadError('Plugload config has no projects.', 'CONFIG_INVALID', 'Add at least one project with name, URL, environment, and tokenEnv.')
  }
  const projects = (parsed as any).projects.map((project: any) => {
    if (!project.name || !project.url || !project.environment) throw new PlugloadError('A Plugload project is missing required settings.', 'CONFIG_INVALID', 'Every project needs name, url, and environment.', project)
    const url = String(project.url).replace(/\/$/, '')
    if (!/^https?:\/\//.test(url)) throw new PlugloadError(`Project ${project.name} has an invalid URL.`, 'CONFIG_INVALID', 'Use an absolute http:// or https:// URL ending in the Payload MCP endpoint.', url)
    return { ...project, name: String(project.name), url, environment: project.environment as EnvironmentKind } as ProjectConfig
  })
  return { projects }
}

export function selectProject(config: PlugloadConfig, name?: string): ProjectConfig {
  const project = name ? config.projects.find((item) => item.name === name) : config.projects.find((item) => item.default) ?? config.projects[0]
  if (!project) throw new PlugloadError(`Unknown Plugload project: ${name}.`, 'PROJECT_NOT_FOUND', `Choose one of: ${config.projects.map((item) => item.name).join(', ')}`)
  return project
}

export function projectToken(project: ProjectConfig, approval = false): string {
  let fileToken: string | undefined
  const tokenFile = approval ? project.approvalTokenFile : project.tokenFile
  const tokenEnv = approval ? project.approvalTokenEnv : project.tokenEnv
  if (tokenFile) {
    try { fileToken = readFileSync(resolve(tokenFile), 'utf8').trim() }
    catch { fileToken = undefined }
  }
  const token = approval ? (tokenEnv ? process.env[tokenEnv] : undefined) ?? fileToken : project.token ?? (tokenEnv ? process.env[tokenEnv] : undefined) ?? fileToken
  if (!token) throw new PlugloadError(`No ${approval ? 'approval ' : ''}API token is available for ${project.name}.`, 'TOKEN_MISSING', `Set ${tokenEnv ?? (approval ? 'approvalTokenEnv' : 'tokenEnv')} or provide a protected tokenFile. Never commit API keys to plugload.config.json.`)
  return token
}
