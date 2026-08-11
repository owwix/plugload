export class PlugloadError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly suggestion: string,
    readonly detail?: unknown,
  ) {
    super(message)
    this.name = 'PlugloadError'
  }

  toJSON() {
    return { error: this.code, message: this.message, suggestion: this.suggestion, detail: this.detail }
  }
}

export function asHumanError(error: unknown): PlugloadError {
  if (error instanceof PlugloadError) return error
  const message = error instanceof Error ? error.message : String(error)
  if (/401|unauthorized|authentication/i.test(message)) {
    return new PlugloadError('Payload rejected the credentials.', 'AUTHENTICATION_FAILED', 'Check the project API key and confirm that MCP access is enabled.', message)
  }
  if (/403|forbidden|access denied/i.test(message)) {
    return new PlugloadError('Payload denied this operation.', 'ACCESS_DENIED', 'Use an API key whose Payload user has access. Plugload never bypasses Payload access control.', message)
  }
  if (/404|not found/i.test(message)) {
    return new PlugloadError('The requested Payload content was not found.', 'CONTENT_NOT_FOUND', 'Check the collection or global slug, document ID, locale, and project environment.', message)
  }
  return new PlugloadError('The content operation could not be completed.', 'OPERATION_FAILED', 'Review the underlying detail, correct the request, and create a new preview before retrying.', message)
}
