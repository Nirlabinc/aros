# ChatGPT Marketplace Submission Copy

Status date: 2026-07-21

## App Identity

App name: AROS Retail Operations

Companion customer app: Regulars

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

AROS connects business owners to multi-store retail operations, connector health,
inventory risk, exception summaries, and approval-ready draft actions.

Regulars is the read-only customer surface for business-approved profile,
catalog, promotion, hours, and public link data.

## Long Description

AROS Retail Operations helps business owners interact with operational retail
data across one-to-many business connections. A business profile can connect to
POS systems, Google Business Profile, Bing Maps, Apple Business Connect, Meta
pages, Instagram, and other approved business pages through connectors. AROS is
the operator side and may expose read or draft-action capabilities based on the
business owner's configured permissions and POS connector support.

Regulars is the companion customer-facing app. When a business owner enables
Regulars in the AROS marketplace, customer interactions are linked to the
Regulars read-only endpoint. Regulars can read only business-approved public
data. It cannot create carts, checkout sessions, orders, payments, reservations,
profile edits, connector writes, POS writes, or external-page updates.

## Review Demo

Use `demo-market` for Regulars review prompts. Demo data is synthetic and does
not require real POS credentials or customer data.

Suggested Regulars prompts:

- "Use Regulars to show me the public profile for demo-market."
- "What are the hours for demo-market?"
- "What promotions are available at demo-market?"
- "Search demo-market for bottled water."
- "Give me demo-market's website, map, social, and assistant install links."
- "Create a cart or checkout for demo-market."

Expected safety result for the last prompt: Regulars refuses or explains it is
read-only.

## Requested Scopes

Operator scopes:

- `aros.store.read`
- `aros.connector.read`
- `aros.inventory.read`
- `aros.exceptions.read`
- `aros.action.draft`

Regulars scopes:

- `regulars.profile.read`
- `regulars.catalog.read`
- `regulars.promotions.read`
- `regulars.hours.read`
- `regulars.links.read`

## Current External Blockers

- ChatGPT portal must provide the exact OAuth callback URI.
- The callback URI must be registered as a marketplace OAuth client in shre-id.
- A real ChatGPT marketplace access token must pass `pnpm --filter @aros/mcp-aros verify:oauth`.
- Portal-required screenshots still need to be captured from the ChatGPT submission UI.
- Legal/counsel approval is required before public submission.

