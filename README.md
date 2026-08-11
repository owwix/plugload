# Plugload

[![CI](https://github.com/owwix/plugload/actions/workflows/ci.yml/badge.svg)](https://github.com/owwix/plugload/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

> **Developer Preview:** Plugload is ready for local development and evaluation. Its APIs and stored operation format may change before the first stable release. Test workflows outside production and keep independent backups.

Plugload is a safe, schema-aware content operations layer for AI agents working with Payload CMS. It extends Payload's official MCP plugin with previews, approvals, optimistic concurrency, workflow controls, and durable audit events. It does not replace Payload MCP or bypass Payload access control.

## What is included

- `packages/core`: schemas, diffs, operation plans, approvals, workflow policy, errors, and audit contracts.
- `packages/mcp`: host-side tools for Payload's official MCP plugin plus a thin multi-project Codex bridge.
- `packages/cli`: connection, configuration, schema, preview, approval, and apply commands.
- `skills/payload-content-operations`: the mandatory safe editing workflow for Codex and ChatGPT.
- `examples/payload-app`: a localized, versioned Payload app using SQLite for local development.

## Safety model

All writes begin with a stored operation plan containing the current value, proposed value, exact field-level diff, environment, risk, and baseline hash. Publishing, deletion, rollback, promotion, bulk changes, and all production writes require a separate approval receipt. Apply re-reads the content and refuses to overwrite changes made since preview.

Payload content calls always pass the authenticated MCP request and `overrideAccess: false`. The `overrideAuth` wrapper shown below attaches the already-authenticated API-key owner to custom-tool requests. Plugload's own hidden plan and audit collections use internal writes so failed and successful agent actions remain traceable; their public access remains locked down.

## Quick start

Requirements: Node.js 20.9 or newer and pnpm 10.

```sh
pnpm install
pnpm check
cp examples/payload-app/.env.example examples/payload-app/.env
pnpm --filter @plugload/example-payload-app dev
```

In Payload Admin, create an MCP API key associated with a user, enable endpoint traffic, and allow only the tools that role needs. Copy `plugload.config.example.json` to `plugload.config.json`, export the token environment variable, then test the bridge:

```sh
pnpm plugload config validate
pnpm plugload connection test --project agency-site-local
pnpm plugload schema inspect --project agency-site-local
pnpm plugload preview operation --file examples/operation.update.json
```

Do not place tokens directly in configuration files. Use a distinct API key per project and environment.

## Payload integration

Add the Plugload internal collections and inject its custom tools/resources into the official plugin:

```ts
import { mcpPlugin } from '@payloadcms/plugin-mcp'
import {
  createPlugloadCollections,
  createPlugloadMcpResources,
  createPlugloadMcpTools,
} from '@plugload/mcp'

const environment = 'staging'

export default buildConfig({
  collections: [Posts, ...createPlugloadCollections()],
  plugins: [
    mcpPlugin({
      overrideAuth: async (req, getDefaultMcpAccessSettings) => {
        const settings = await getDefaultMcpAccessSettings()
        req.user = settings.user
        return settings
      },
      collections: { posts: { enabled: { find: true, create: true, update: true } } },
      mcp: {
        tools: createPlugloadMcpTools({ environment, projectName: 'client-site' }),
        resources: createPlugloadMcpResources({ environment, projectName: 'client-site' }),
      },
    }),
  ],
})
```

The full working configuration is in `examples/payload-app/src/payload.config.ts`.

## Compatibility

Plugload requires Payload's extensible official MCP plugin, introduced in Payload 3.83. It declares peer support for Payload 3.83 through 4.x; the example is pinned to Payload and `@payloadcms/*` 3.84.1.

Payload requires every `payload` and `@payloadcms/*` package in one installation to use exactly the same version and resolve only once. Pin those packages without `^` or `~`. Payload 3.84.1 requires Next `>=15.4.11 <15.5.0` (or another range declared by its peer metadata) and its MCP handler requires MCP SDK 1.26.0. The example pins Next 15.4.11, React/React DOM 19.1.1, and MCP SDK 1.26.0. Plugload itself requires Node.js 20.9 or newer.

Payload 4 was still canary at the time this baseline was created. Test it in a non-production environment before adopting it, and update every Payload package together.

## Production notes

- Replace the default in-memory database in the example with your supported production adapter.
- Configure collection access rules and MCP API-key capabilities according to least privilege.
- Route Payload MCP `onEvent` logs and `plugload-audit-events` to your central observability system.
- Back up version tables and audit data; set retention according to client policy.
- Use separate configuration entries and credentials for each agency client and environment.
- Expose the MCP endpoint only over HTTPS outside local development.

See [docs/architecture.md](docs/architecture.md) and [docs/setup.md](docs/setup.md) for implementation and operational details.

## Open source

Plugload is available under the [Apache License 2.0](LICENSE). Contributions are welcome; read [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and the [threat model](docs/threat-model.md) before proposing changes to safety-sensitive behavior.
