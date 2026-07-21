# Claude Connector Submission Copy

Status date: 2026-07-21

## App Identity

Connector name: AROS Retail Operations

Companion customer connector: Regulars

Publisher: Nirlab Inc.

Support/security contact: info@rapidinfosoft.com

Privacy policy: https://www.aros.live/legal/privacy/

Terms of service: https://www.aros.live/legal/terms/

## Endpoints

Operator MCP URL: https://mcp.shre.ai/aros/operator

Customer/read-only MCP URL: https://mcp.shre.ai/regulars

Operator discovery metadata: https://mcp.shre.ai/.well-known/mcp/operator

Regulars discovery metadata: https://mcp.shre.ai/.well-known/mcp/customer

Protected resource metadata: https://mcp.shre.ai/.well-known/oauth-protected-resource

Authorization server metadata: https://mcp.shre.ai/.well-known/oauth-authorization-server

OAuth issuer: https://id.shre.ai

OAuth resource/audience: https://mcp.shre.ai/aros

## Short Description

AROS lets retail business owners query connected operations data across stores,
connectors, inventory, exceptions, and approval-ready draft actions.

Regulars exposes customer-facing business profile, catalog, promotions, hours,
and approved links as a read-only MCP surface.

## Connector Behavior

AROS is the business-owner connector. It uses OAuth and tenant-scoped
permissions. Depending on the connected POS and owner configuration, the
operator side can read supported operational data and create approval-ready draft
actions. It does not directly mutate POS, payment, vendor, or social accounts.

Regulars is the consumer connector. It is always read-only. Even when a business
has write-capable systems connected in AROS, Regulars exposes only the
business-approved public profile, links, hours, promotions, and catalog search.

## Review Demo

Use `demo-market` for Regulars review prompts. Demo data is synthetic and does
not require real POS credentials or customer data.

Suggested Claude prompts:

- "Use Regulars to read the demo-market business profile."
- "Show demo-market promotions and hours."
- "Find public links for demo-market."
- "Can you update demo-market's Instagram link?"

Expected safety result for the last prompt: Claude should not update anything
through Regulars because the connector is read-only.

## Current External Blockers

- Claude hosted connector portal must provide the exact OAuth callback URI.
- The callback URI must be registered as a marketplace OAuth client in shre-id.
- A real Claude marketplace access token must pass `pnpm --filter @aros/mcp-aros verify:oauth`.
- Portal-required screenshots still need to be captured from the Claude submission UI.
- Legal/counsel approval is required before public submission.

