---
name: payload-project-onboarding
description: Install, configure, validate, or troubleshoot Plugload for one or more Payload CMS projects while building on Payload's official MCP plugin. Use when connecting a Payload app to Codex or ChatGPT, adding Plugload to an existing Payload configuration, creating least-privilege agent and approver roles, configuring agency projects or environments, testing MCP connectivity, checking Payload compatibility, or diagnosing missing Plugload tools.
---

# Payload Project Onboarding

Connect Payload through its official MCP plugin, then add Plugload as the schema-aware safety layer. Do not create a parallel generic Payload MCP server.

## Onboarding workflow

1. Inspect the Payload app, package manager, installed Payload version, auth collection, access functions, drafts, versions, localization, and existing MCP configuration.
2. Confirm current compatibility from the installed `@plugload/mcp` peer dependency range. When versions or setup guidance may have changed, verify against the latest official Payload MCP documentation before editing.
3. Install compatible versions of `@payloadcms/plugin-mcp` and `@plugload/mcp` with the project's existing package manager.
4. Add Plugload's internal collections, hosted tools, and resources to the Payload configuration. Follow [references/integration.md](references/integration.md).
5. Explicitly allowlist content collections and globals. Exclude auth users, secrets, audit records, and Plugload's internal collections from agent content access.
6. Preserve Payload request identity with the official plugin's `overrideAuth` flow. Keep `overrideAccess: false`; never replace Payload access control with Plugload authorization.
7. Create separate least-privilege identities:
   - Agent: native read tools plus only the Plugload planning/apply/audit tools required for its role.
   - Approver: `plugload_approve_operation` and read-only audit/schema access. Keep this credential outside the agent runtime.
8. Set `environment` from trusted deployment configuration, never from an MCP tool argument. Use a strong `PLUGLOAD_APPROVAL_SIGNING_SECRET` outside development.
9. Add one client configuration entry per project environment. Use stable, descriptive names such as `client-site-staging`; mark at most one default.
10. Store tokens in environment variables or protected token files. Never commit tokens or place approver credentials in `.mcp.json`.
11. Build and validate in this order:
    - `plugload config validate`
    - `plugload connection test --project <name>`
    - `plugload schema inspect --project <name>`
12. Confirm that connection output includes `plugload_plan_operation`, `plugload_apply_operation`, and the audit tools before enabling writes.

## Compatibility rules

- Treat the installed `@plugload/mcp` `peerDependencies` as the supported range for that release.
- Keep Payload core and official Payload packages on compatible versions; do not mix arbitrary minor versions when Payload requires alignment.
- Upgrade through the project's normal migration process. Discard unexpired plans and approvals after schema or signing changes.
- Test the example Payload app and the full repository check when modifying Plugload itself.

## Multi-project rules

- Model every environment as a separate project entry with its own URL, token, and explicit environment label.
- Never infer production from a hostname or project name; trust only validated configuration.
- Use different Payload API keys per client and environment. Do not share one agency-wide production key.
- Do not copy relationship database IDs across environments. Configure stable-key mapping before promotion.
- Test development or staging before production, but do not assume staging access implies production access.

## Failure handling

- `TOKEN_MISSING`: set the named token environment variable or protected token file; do not inline a token into config.
- Authentication failure: rotate or correct the scoped key; do not broaden collection permissions blindly.
- Missing host tools: verify the tools/resources were passed to `mcpPlugin` and enabled for the API key.
- Access denied: inspect the Payload user's role and collection/global access functions.
- Schema mismatch after deploy: migrate, reconnect, inspect again, and create new plans.
- Audit persistence failure: stop writes until Plugload's internal collections are healthy.

After onboarding, use `$payload-content-operations` for all content reads and changes.
