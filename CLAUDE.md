# aros-platform

AROS (Agentic Retail Operating System) — customer-facing platform monorepo. Provides
licensing, onboarding, connectors, skills, and the AROS web UI. AROS is a customer of
the Shre AI platform, not a core service.

## Quick Reference

- **Port**: 5457 (from ports.json)
- **Framework**: Turbo monorepo (pnpm), Node built-in HTTP for health server
- **Run**: `pnpm dev` (turbo) or `npx tsx src/server.ts` (health server only)
- **Build**: `pnpm build`

## Key Files

| Path | Purpose |
|------|---------|
| src/index.ts | Platform entry point — license boot-guard, public API exports |
| src/server.ts | Health server (/health, /readyz) on port 5457 |
| src/licensing/ | License enforcement, boot-guard, tier management |
| src/blocks/ | Block registry, executor, event helpers |
| src/tools/ | CLI tools (license generation) |
| aros-ai/ | AI agent layer (ADP server, shre-control socket) |
| apps/web/ | Vite-based web UI |
| packages/core/ | Core shared package |
| packages/pos-sdk/ | POS SDK package |
| connectors/ | Data connectors (Azure DB, etc.) |
| skills/ | AROS skill definitions |
| onboarding/ | Customer onboarding flow |
| marketplace/ | Marketplace registry sync |
| aros.config.json | Platform configuration |

## Architecture

AROS is a **monorepo** managed by Turbo with pnpm workspaces. The platform enforces
license validation at boot via `enforceBootGuard()` before any services or plugins load.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /health | Health check with uptime and version |
| GET | /readyz | Readiness probe |

## Notes

- This is a git submodule in the shre-router monorepo
- Shre integration is optional (`shre.enabled` in aros.config.json)
- Whitelabel support via `whitelabel/` directory

## Journey gate (define the journey before code)

No new user-facing capability starts as code — it starts as a Journey Spec at
`docs/journeys/<slug>.md` (template + rules: `.claude/JOURNEY_GATE.md`; golden
journeys index: `docs/journeys/README.md`; the `journey-council` subagent
drafts specs). A PR that adds or alters a journey merges only with the spec
created/updated AND a golden-path E2E that drives the real UI the way a
stranger would — from the entry point, reading only what's on screen, no
seeded state, no API shortcuts — asserting the user-visible success signal.
Two invariants: "must already know" trends to zero, and every failure state
recovers without support. If the capability needs activation (flag,
credential, operator step) to show real data, the UI states that honestly
until wired — plausible output from an unwired surface is a defect. Before a
user-facing release is called done, walk the deployed surface:
`node scripts/journey-walk.mjs --base <url>` (seam-level), then the
`journey-walker` subagent for steps it marks NEEDS-BROWSER. Done = the
persona (Ramesh, `docs/journeys/README.md`) completes the journey on beta
without help. Changes that don't alter a journey skip this — say so
explicitly.
