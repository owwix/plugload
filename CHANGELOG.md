# Changelog

All notable changes will be documented here. Plugload follows Semantic Versioning after the developer-preview period.

## Unreleased

### Added

- Separately authenticated approvals bound to the exact plan digest.
- One-time approval consumption and idempotent operation application.
- Explicit collection/global allowlists and schema-drift protection.
- Tamper-evident audit hash chains with CLI verification.
- Real Payload integration tests for access controls and durable workflows.

### Security

- Agent MCP connections no longer expose an approval forwarding tool.
- Production plans reject self-approval, altered plans, reused receipts, stale content, and stale schemas.
