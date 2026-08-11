# Threat model

## Scope and security objectives

Plugload sits between an AI agent and Payload CMS. Its primary objectives are to preserve Payload authorization, make consequential changes deliberate, prevent stale overwrites, avoid cross-project confusion, and leave a durable record of every attempted action.

Plugload does not make an untrusted model a trusted administrator. A deployment is only as secure as its Payload access rules, API-key scope, approval channel, host, audit storage, and operators.

## Trust boundaries

1. **Agent and client:** prompts, tool arguments, and displayed approvals may be mistaken or adversarial.
2. **Plugload bridge:** configuration maps an explicit project and environment to a Payload MCP endpoint and credential source.
3. **Payload MCP endpoint:** Payload authenticates the key and its official MCP plugin exposes only enabled operations.
4. **Payload application and database:** collection and field access rules, hooks, validation, drafts, and versions remain authoritative.
5. **Approver:** a human or independently trusted system confirms the stored plan for consequential work.
6. **Audit storage:** records must be access-controlled, retained, monitored, and protected from tampering.

## Primary threats and controls

| Threat | Controls | Residual risk |
| --- | --- | --- |
| Prompt injection requests unsafe tools | Minimal tool exposure, schema validation, stored previews, approval gates | An authorized operator can still approve a harmful plan |
| Payload authorization bypass | `overrideAccess: false`, authenticated request propagation, least-privilege API keys | Incorrect Payload access rules remain dangerous |
| Stale or conflicting update | Baseline hash and re-read immediately before apply | External side effects in hooks may not be reversible |
| Approval replay or plan substitution | Separate Payload identity, signed plan digest, atomic one-time consumption, action and environment binding | Exposing the approver credential to an agent destroys the boundary |
| Cross-client or production confusion | Named project/environment config, production write approval, per-environment credentials | Mislabelled configuration can direct work incorrectly |
| Secret disclosure | Environment or token-file references, ignored local config, redacted errors | Host logs or third-party transports may leak secrets |
| Audit tampering or loss | Append-only audit contract, SHA-256 hash chain, and Payload-backed persistence | Database administrators can rewrite a complete chain; export anchors to immutable storage for stronger guarantees |
| Destructive or high-volume mutation | Explicit gates for delete, publish, rollback, promotion, bulk, and production actions | A compromised approver may authorize damage |
| Schema drift | Live schema inspection and validation before planning/apply | Custom hooks and external systems may impose undiscoverable constraints |
| Denial of service | Bounded tool inputs and server-side access controls | Rate limiting and infrastructure protection are deployment responsibilities |

## Security invariants

- Content operations never set `overrideAccess: true`.
- A consequential operation cannot be applied without a valid, matching approval.
- The planning actor cannot approve its own plan, and the agent bridge does not expose approval.
- Every target slug must be explicitly allowlisted in Plugload as well as enabled in Payload MCP.
- Apply refuses a plan when the current baseline differs from its preview.
- Project, environment, actor, target, result, and correlation data are recorded for every attempt.
- Secrets are not accepted as ordinary tracked configuration values or written to audit details.
- Unknown or ambiguous authorization and workflow states fail closed.

Changes that weaken an invariant require explicit documentation, tests, and maintainer security review.

## Out of scope and known limitations

- Securing the underlying Payload deployment, database, network, model provider, or operator workstation.
- Detecting every malicious semantic change to otherwise valid content.
- Reversing arbitrary side effects caused by Payload hooks or downstream integrations.
- Providing non-repudiation when approver identity or audit storage is controlled by the same compromised principal.
- Guaranteeing compatibility with unpublished Payload internals; integrations should use documented plugin extension points.

## Recommended deployment posture

Start read-only, enable narrow draft writes in a non-production environment, verify audit export and restore procedures, then add separately authenticated approvals. Use different credentials for every client and environment. Keep publishing and deletion disabled unless required. Send audit events to immutable or independently administered storage for high-assurance deployments.
