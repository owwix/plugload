# Setup and operations

## 1. Add Plugload to a Payload project

Install `@plugload/mcp` beside Payload's official `@payloadcms/plugin-mcp`. Add `createPlugloadCollections()` to `collections`, then pass `createPlugloadMcpTools()` and `createPlugloadMcpResources()` into the official plugin's `mcp` options. Set the environment from trusted deployment configuration, not tool arguments. Use `overrideAuth` as shown in the example to assign the default MCP API-key owner's `settings.user` to `req.user`; custom Plugload tools then use the same user context as Payload's native MCP tools.

## 2. Configure Payload access

Create a dedicated Payload user for each agent role. Create an MCP API key for that user, enable endpoint access, and allow the minimum native and Plugload tools needed. Do not enable `plugload_approve_operation` for an agent key. Payload's native and Plugload content operations execute with that user request and `overrideAccess: false`.

Create a different Payload user and API key for approvers. Configure `canApprove` to recognize a trusted role, and expose only the approval and audit tools to that key. Keep this credential outside the agent host, environment, filesystem, and MCP configuration. An approver uses the CLI from a separately trusted session and returns only the one-time approval ID.

Keep native delete disabled unless another trusted client needs it. Plugload deletion is planned and approved, but the underlying user must still have collection delete access.

## 3. Configure clients

Copy `plugload.config.example.json` to the ignored `plugload.config.json`. Add a project record per client environment. Put tokens in the named environment variables.

The root `.mcp.json` starts Plugload over stdio for Codex. Other MCP clients can point directly at Payload's `/api/mcp` endpoint with a Bearer token, though the Plugload skill is still recommended for workflow guidance.

## 4. Validate

Run `pnpm check`, then `plugload config validate`, `plugload connection test`, and `plugload schema inspect`. Confirm the connection report includes the host tools before allowing writes.

When upgrading an existing preview installation, deploy the added operation-state and audit-hash fields through the normal Payload migration workflow. Existing unexpired plans and approvals must be discarded because they do not have a signed digest. The audit verifier will report legacy unchained events; export them as a separate legacy segment and begin a new anchored chain.

## 5. Operate safely

Use a new plan after any validation error, schema deployment, content conflict, or expiration. Approvals must use the exact `APPROVE <planId> <digest-prefix>` value returned by preview. Never reuse approvals. Verify publishing, rollback, bulk edits, and promotion with a fresh read and audit lookup. Run `plugload audit verify` regularly and export the chain to independently controlled storage.

## Failure recovery

- Authentication error: rotate or correct the project token; do not broaden collection access blindly.
- Access denied: inspect the Payload user's role and collection access function.
- Missing host tool: confirm Plugload tools were passed to `mcpPlugin` and allowed on the API key.
- Stale plan: read current content and create a new plan.
- Audit failure: stop writes until the internal collections are migrated and writable.
