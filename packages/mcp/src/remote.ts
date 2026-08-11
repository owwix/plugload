import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { asHumanError } from '@plugload/core'
import { projectToken, type ProjectConfig } from './config.js'

export async function withPayloadClient<T>(project: ProjectConfig, operation: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ name: 'plugload', version: '0.1.0' })
  const transport = new StreamableHTTPClientTransport(new URL(project.url), { requestInit: { headers: { Authorization: `Bearer ${projectToken(project)}` } } })
  try { await client.connect(transport as any); return await operation(client) }
  catch (error) { throw asHumanError(error) }
  finally { await client.close().catch(() => undefined) }
}

export function resultValue(result: any): unknown {
  if (result?.structuredContent !== undefined) return result.structuredContent
  const text = result?.content?.find((item: any) => item.type === 'text')?.text
  if (typeof text !== 'string') return result
  try { return JSON.parse(text) } catch { return text }
}
