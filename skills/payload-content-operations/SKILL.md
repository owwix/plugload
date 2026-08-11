---
name: payload-content-operations
description: Safely inspect, read, draft, review, update, publish, delete, roll back, bulk-edit, or promote Payload CMS content through Plugload and Payload's official MCP integration. Use for any agent-driven Payload collection or global operation, schema discovery, access or validation questions, localization work, content previews, approval flows, or audit review.
---

# Payload Content Operations

Use Plugload as the safety and workflow layer. Use Payload's official MCP tools for ordinary reads and the Plugload tools for schema inspection and every write workflow.

## Mandatory workflow

1. Call `plugload_projects` when the project or environment is ambiguous.
2. Call `plugload_connection_test` before the first operation in a session.
3. Call `plugload_schema_inspect` before using an unfamiliar collection, global, field, relationship, locale, or workflow.
4. Read the current content with `plugload_content_read`. Never infer the current value.
5. For a change, call `plugload_operation_plan` with one focused request and a concrete reason.
6. Present the plan summary and field-level `diff` to the user. Clearly name the project and environment.
7. If `approvalRequired` is true, stop before applying. Ask for explicit approval of that plan ID.
8. After the user approves, call `plugload_operation_approve` with the exact confirmation `APPROVE <planId>`.
9. Call `plugload_operation_apply` with the returned approval ID when required.
10. Report the result and audit identifier. Re-read consequential content to verify it.

## Hard safety rules

- Never publish, delete, bulk-edit, roll back, promote, or change production content without explicit approval.
- Never treat a general request such as “make it live” as approval for a plan the user has not seen.
- Never bypass Payload access controls or ask for broader credentials merely to make an operation succeed.
- Never apply a stale or expired plan. Create a new preview and show the new diff.
- Default uncertain writes to drafts. Do not silently turn an update into a publish.
- Keep locale explicit for localized fields. Do not overwrite other locales.
- Keep edits narrowly scoped. Split unrelated changes into separate plans.
- Treat relationship IDs as schema-bound references; verify the referenced document exists.
- Do not expose API keys, authentication headers, hidden fields, or audit internals.

## Workflow semantics

- `save-draft`: create or update without publishing.
- `submit-review`: save a draft and move its configured review state forward.
- `publish`: make the selected revision live; always requires approval.
- `rollback`: preview the selected historical version before restoring it; always requires approval.
- `promote`: compare source and destination environments and plan against the destination baseline; always requires approval.
- `bulk-update`: show affected IDs and aggregate plus per-document changes; always requires approval.

If an operation fails, relay Plugload's human-readable message and suggestion. Do not retry writes automatically. For detailed rollback and promotion handling, read [references/workflows.md](references/workflows.md).
