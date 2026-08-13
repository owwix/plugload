# Integration reference

## Payload configuration shape

Adapt this structure to the host app; preserve its existing database, editor, collections, globals, and access rules.

```ts
import { mcpPlugin } from '@payloadcms/plugin-mcp'
import {
  createPlugloadCollections,
  createPlugloadMcpResources,
  createPlugloadMcpTools,
} from '@plugload/mcp'

const environment = process.env.PLUGLOAD_ENVIRONMENT as
  | 'development'
  | 'preview'
  | 'staging'
  | 'production'

const plugloadTools = createPlugloadMcpTools({
  environment,
  projectName: 'client-site',
  collections: ['posts', 'categories'],
  globals: ['site-settings'],
  approvalSigningSecret: process.env.PLUGLOAD_APPROVAL_SIGNING_SECRET,
  canApprove: ({ req }) => ['publisher', 'admin'].includes(String(req.user?.role)),
})

const plugloadResources = createPlugloadMcpResources({
  environment,
  projectName: 'client-site',
})

export default buildConfig({
  collections: [Users, Posts, Categories, ...createPlugloadCollections()],
  globals: [SiteSettings],
  plugins: [
    mcpPlugin({
      overrideAuth: async (req, getDefaultMcpAccessSettings) => {
        const settings = await getDefaultMcpAccessSettings()
        req.user = settings.user as typeof req.user
        return settings
      },
      collections: {
        posts: { enabled: { find: true, create: true, update: true, delete: false } },
        categories: { enabled: { find: true, create: true, update: true, delete: false } },
      },
      globals: {
        'site-settings': { enabled: { find: true, update: true } },
      },
      mcp: {
        tools: plugloadTools,
        resources: plugloadResources,
      },
    }),
  ],
})
```

Fail startup outside development when `PLUGLOAD_ENVIRONMENT` or `PLUGLOAD_APPROVAL_SIGNING_SECRET` is missing. Do not use a development fallback in deployed environments.

## Multi-project client configuration

```json
{
  "projects": [
    {
      "name": "client-site-staging",
      "url": "https://staging-cms.example.com/api/mcp",
      "environment": "staging",
      "tokenEnv": "CLIENT_SITE_STAGING_MCP_TOKEN",
      "default": true
    },
    {
      "name": "client-site-production",
      "url": "https://cms.example.com/api/mcp",
      "environment": "production",
      "tokenEnv": "CLIENT_SITE_PRODUCTION_MCP_TOKEN"
    }
  ]
}
```

Keep approver configuration in a separate trusted CLI context when possible. If `approvalTokenEnv` or `approvalTokenFile` is used, ensure that configuration is unavailable to the agent host.

## Codex MCP entry

```json
{
  "mcpServers": {
    "plugload": {
      "command": "npx",
      "args": ["--yes", "@plugload/mcp"],
      "env": {
        "PLUGLOAD_CONFIG": "./plugload.config.json"
      }
    }
  }
}
```

Pin an exact package version in controlled production environments. Local Plugload development may instead invoke the built `packages/mcp/dist/stdio.js` entrypoint.
