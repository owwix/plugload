# Contributing to Plugload

Thanks for helping make agent-driven content operations safer.

## Before you start

For substantial features or changes to the approval, access-control, or audit model, open an issue first so the security and compatibility implications can be agreed on. Report vulnerabilities privately according to [SECURITY.md](SECURITY.md).

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md). Contributions are licensed under Apache-2.0 under the terms described in the repository license.

## Development

Requirements: Node.js 20.9 or newer and pnpm 10.

```sh
pnpm install --frozen-lockfile
pnpm check
```

Use the example app for integration work:

```sh
cp examples/payload-app/.env.example examples/payload-app/.env
pnpm --filter @plugload/example-payload-app dev
```

Never commit `.env` files, Payload databases, local tokens, admin credentials, or `plugload.config.json`.

## Pull requests

- Keep each change focused and explain its user-visible and security impact.
- Add or update tests for behavior changes.
- Preserve Payload access controls and fail closed when authorization, validation, or state is uncertain.
- Include before-and-after examples for workflow or CLI changes.
- Update documentation and compatibility notes when dependencies or setup change.
- Confirm `pnpm check` passes.

Maintainers may request a threat-model update for changes that add tools, credentials, persistence, network access, or write paths.
