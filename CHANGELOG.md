# AROS Platform Changelog

All notable changes to AROS Platform are documented here.
Follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning: [Semantic Versioning](https://semver.org/).

## [Unreleased]
### Changed
- Expanded the AROS connector Marketplace and linked Gmail, Google Workspace, Microsoft 365, Slack, HubSpot, Mailchimp, SendGrid, and Twilio setup to the canonical MIB configuration surfaces.
- Models now load from the live Shre router catalog, and chat supports explicit Auto, Claude, OpenAI, Gemini, and other connected model selection.
- Chat responses identify the model that actually answered, including transparent local fallback.
- Commander setup now creates the canonical store mapping and a one-time Edge pairing code in the same flow.
- Reworked Verifone Commander onboarding as an Edge-first flow with required store name, optional store number, LAN/Edge guidance, and no misleading cloud-side direct test.
- Added confirmation before removing a store/POS connection.
- Added context-aware Marketplace navigation from Apps, Connectors, Plugins, Skills, and Agents.
- Standardized spacing between page search controls and installed-resource content.
- Store connection management now supports title, details, access mode, provider configuration, and secure credential rotation with automatic re-testing.

### Planned / In Progress
- Converge the redesign canvas onto the shared `mib-widget` content-block contract (once the live fork picks up PR #38)
- Restyle the Login/Signup auth screens to the new theme
- MIB API reuse for resources/POS (blocked on a shre-id tenant↔company token bridge)
- Shre brain sync integration; BYOM model selector; Licensing module

## [0.5.1] — 2026-07-16 — Post-flip security hardening
### Security
- App-shell HTML (and the index.html SPA fallback) now returns `Cache-Control: private, no-store`, so no shared cache/CDN stores the authenticated bootstrap. Fingerprinted `/assets/*` stay `public, immutable`. (`src/server.ts` `sendStaticFile`)
### Verified (post-flip audit, redesign now default)
- **Tenant isolation:** the server never trusts the `x-aros-tenant-id` header — `authenticateRequest()` validates the Bearer token, then requires an active `tenant_members` row for `(user, requested_tenant)`; a mismatch yields zero rows → 401, and the effective tenant is read from the DB membership. Every data query scopes by `auth.tenantId`; workspace routes add an explicit `!== → 403`. Unauthenticated `/api/*` returns 401.
- **No demo-data leak:** demo persona/figures are gated on `useDemo() === !session` and only render on the unauthenticated `/preview/app` route; the served shell embeds no persona. A live session shows real fetches and empty states.

## [0.5.0] — 2026-07-16 — Chat-first redesign (soft launch)
### Added
- Chat-first "Command Home" redesign — warm Stripe/Apple theme (light/dark), gated behind `?redesign=1` (OFF by default; old dashboard unchanged).
- Home ⇄ chat slide; conversation canvas with Canvas/History tabs; 4-step Connect-a-register wizard (RapidRMS + Verifone).
- Left-panel profile (role + workspace nav), whitelabel branding module, responsive (mobile/tablet), consistent docked sidebar.
- Live data wiring: `/api/connectors`, `/api/resources/*`, `/api/dashboard`, `/api/store/summary`, `/api/billing/status`. Demo persona/figures render ONLY when unauthenticated (`/preview/app`) — never in a live session.
### Notes
- Deployed to production on 2026-07-16, reconciled onto the hand-managed VPS live fork (`live/direct-deploy`), not a main-based build. Initially gated behind `?redesign=1`; a concurrent workstream then **flipped it to the default** authenticated experience (legacy opt-out via `?redesign=0` → `aros-shell-legacy`) and added working sign-out + session-establishment fixes (`8e7551a`, `e3d3e7b`, `fe77441`). Per-browser rollback to the legacy UI: `?redesign=0`.

## [0.4.0] — 2026-03-25
### Added
- Health server, web app, security hardening, RBAC, ArosChat redesign.

## [0.3.1] — 2026-03-18
### Added
- Plugin & connector developer guide, DATA_PLUGIN_GUIDE, first-party app catalog.

## [0.3.0] — 2026-03-18
### Added
- RapidRMS connector, AWS RDS connector, Conexxus local store, third-party plugin docs, marketplace database nodes.

## [0.2.0] — 2026-03-18
### Added
- Public release: BSL license, BYOM enforcement, AI Models settings UI, rapidrms-ops submodule.

## [0.1.0] — 2026-03-18
### Added
- Initial AROS Platform scaffold
- Whitelabel system (theme, logo, agent name, full UI customization)
- AROS AI agent (platform driver — soul, tools, LLM provider)
- Shre auth plugin (ShreProvider + ArosProvider fallback)
- Marketplace registry (fetch + install nodes from MIB007)
- Updater (core + UI update channels, policy engine, history tracking)
- Versioning system (semver utilities, manifest parsing, two-channel updates)
- Licensing module (free/business/OEM tiers, user limits, BYOM)
- Agent Data Protocol (ADP) — Shre-facing brain API
- Shre control socket (WebSocket directives + events)
- Deploy configs (Docker Compose, Dockerfile, Kubernetes)
- Core: thin wrapper around @mib007/core (version-pinned)
