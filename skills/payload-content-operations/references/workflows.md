# Rollback and promotion workflows

## Rollback

1. Confirm that versions are enabled for the target schema.
2. Identify the exact document and version ID.
3. Plan `rollback`; review the live-to-version diff.
4. Require explicit approval for the returned plan ID.
5. Apply once, then re-read the document and inspect the audit event.

Never emulate rollback by copying an old response into a normal update. Use Payload's version restore operation so hooks and version history remain meaningful.

## Environment promotion

1. Read the source revision and destination baseline from explicitly named projects.
2. Confirm compatible schemas and locales. Stop on missing or incompatible fields.
3. Convert relationships through configured stable keys; do not assume database IDs match across environments.
4. Plan against the destination and show additions, changes, and removals.
5. Require explicit approval even when the destination is not production.
6. Apply in dependency order, verify each result, and retain source and destination audit identifiers.

Do not promote secrets, user records, audit collections, MCP API keys, or Plugload's internal operation records.
