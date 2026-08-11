# Security policy

## Supported versions

Plugload is currently a developer preview. Security fixes are applied to the latest commit on `main`; no released version has a separate maintenance window yet.

## Reporting a vulnerability

Do not open a public issue for suspected vulnerabilities, leaked credentials, authorization bypasses, or unsafe content mutations. Use GitHub's private vulnerability reporting for this repository: **Security → Advisories → Report a vulnerability**.

Include the affected version or commit, configuration, impact, reproduction steps, and any suggested mitigation. Remove production content and credentials from reports. Maintainers will acknowledge a complete report as soon as practical, coordinate a fix and disclosure, and credit reporters who want attribution.

## Operational expectations

- Use one least-privilege Payload API key per project and environment.
- Never store tokens in tracked configuration or audit payloads.
- Keep Payload access rules enabled; Plugload must not be used to bypass them.
- Require a separate approval for production writes, publication, deletion, bulk edits, rollback, and promotion.
- Keep the approver API key outside every agent runtime; use a different Payload user and trusted session.
- Configure explicit Plugload collection/global allowlists matching the official Payload MCP exposure.
- Back up content and audit data before production use.

See [docs/threat-model.md](docs/threat-model.md) for trust boundaries and known limitations.
