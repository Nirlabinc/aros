# AROS UI rebuild task matrix

Visual reference: the chat-first UI served locally on port 5199. Functional reference: MIB007. Production target: `app.aros.live`.

## Shared contract

- Preserve Supabase authentication and tenant scoping.
- Use the existing `rsx2-*` design tokens and shell; do not introduce a second design system.
- Live sessions must never render fabricated metrics or demo identities.
- Every page needs loading, empty, error, retry, and populated states.
- All requests carry the current bearer token and `x-aros-tenant-id` where available.
- Mutating actions remain approval-gated and must provide visible success/error feedback.
- Keyboard access, focus visibility, reduced motion, responsive layout, font scaling, and translation-ready copy are required.
- Reuse an existing AROS endpoint first. Reuse/proxy a proven MIB API only where AROS has a genuine endpoint gap.

## Page bundles

| Bundle | Routes | Primary outcome |
|---|---|---|
| Connections | `/stores`, `/apps` | POS/store connections, connector health, app marketplace and OAuth/connect flows |
| Intelligence | `/skills`, `/agents`, `/models` | Tenant resources, configuration, lifecycle controls, model providers and fallback selection |
| Governance | `/permissions`, `/health` | Role scopes, approval gates, service/connector status and diagnostics |
| Workspace | `/team`, `/billing`, `/usage`, `/settings` | Members/invites, plan/invoices, metering, workspace preferences |
| Core | `/dashboard`, `/chat` | Real home metrics/activity/approvals; streaming chat, history, model choice, canvas blocks |

## Integration gates

1. Typecheck and production build.
2. Route-by-route unauthenticated redirect test.
3. Authenticated smoke with a real tenant.
4. No demo data in authenticated mode.
5. Desktop, tablet, and phone visual pass in light and dark themes.
6. Deploy to the live fork only after production smoke passes locally/staging.
