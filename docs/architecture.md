# Architecture

```text
Codex / ChatGPT
      |
      | Plugload skill + stdio bridge
      v
Official Payload MCP endpoint
      |
      +-- native Payload find/create/update tools
      |
      +-- Plugload custom tools
            schema -> plan -> approval -> apply -> audit
                              |
                              +-- Payload Local API with req + overrideAccess:false
```

The bridge is intentionally thin. It opens a standard streamable HTTP MCP connection to each configured Payload endpoint and forwards Plugload's curated operations. Reads resolve and call the official collection/global tools. The Payload-hosted adapter handles schema introspection and consequential writes because that is where the authenticated `PayloadRequest`, server config, local validation, versions, and access rules are available.

Plans and approvals live in `plugload-operations`; append-only, hash-chained audit events live in `plugload-audit-events`. IDs are unguessable UUIDs, plans expire, and schema/content hashes prevent stale application. A separately authenticated approver signs the exact plan digest; the receipt is consumed once. Apply atomically claims the plan and stores its result so transport retries are idempotent.

For agency use, project name is a first-class argument. Each configured project has its own URL, environment classification, and token environment variable. Production classification cannot be overridden by an agent request.
