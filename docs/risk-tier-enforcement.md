# Risk-tier enforcement — design & surface

**Status:** substrate shipped, enforcement designed (not yet wired).
**Depends on:** `20260717_risk_tier_provisioning.sql` (APPLIED to prod 2026-07-20)
— `tenant_resources.risk_tier` + generated `requires_approval` +
`derive_risk_tier()`, backfilled (read / approval_gated, fail-closed).

## What is already true

Every provisioned resource (skill/tool/agent/…) carries a normalized risk
tier: `read < reversible < approval_gated < sensitive`. `requires_approval`
is a generated column (`true` for approval_gated/sensitive). The resource
listing endpoint (`src/server.ts`, `GET` tenant_resources by kind, `select('*')`)
already returns both fields — **the data flows to consumers today.**

## Where enforcement does NOT belong (verified)

- **`skills/src/runner.ts` (`runSkill`)** — dead code, zero live callers.
  Gating here is invisible.
- **AROS `src/server.ts` / live fork** — AROS does not execute tools; it
  proxies agent/tool calls to shre-router (`/api/v1/*` → `SHRE_ROUTER_URL`).
  A gate here would only cover the proxy hop, not execution.

## Where it DOES belong: shre-router

shre-router is the execution + policy plane and already has the machinery:
- `tool-permissions.ts` / `data-permissions.ts` — per-agent, per-source grants
- `approval-matrix.ts` — full approval state machine (RiskLevel low→critical,
  escalation, notification channels)
- `tool-approval.ts` — pattern-based approval gating

**The increment:** when shre-router executes a tool/skill/agent action on
behalf of an AROS tenant, resolve the backing `tenant_resources` row and map
its tier into the existing approval flow:

```
resource.requires_approval == true
  → approval_gated  → approvalMatrix RiskLevel = high  (one approver)
  → sensitive       → approvalMatrix RiskLevel = critical (dual-control)
resource.risk_tier == read | reversible
  → execute inline (no approval)
```

Resolution source: shre-router reads the resource tier either (a) from AROS's
resource API (the listing already returns `risk_tier`/`requires_approval`), or
(b) from a synced projection. Prefer (a) — single source of truth, no drift.

Fail closed: a resource that cannot be resolved, or has no tier, is treated as
`approval_gated` (matches the DB default and `derive_risk_tier`).

## Parity with MIB

This mirrors MIB's PDP (`decideToolCall`, shre-command-center): same tier
vocabulary (`packages/shared/risk-tier.ts`), same allow/stage/deny ladder,
same fail-closed stance. AROS resources gain the same governance MIB tools
have, enforced at the plane that actually executes them.

## Build notes

- Bounded change in shre-router's tool-execution path; reuses `approvalMatrix`
  rather than adding a new gate.
- Verify against the live shre-router + AROS prod DB (pooler creds via OpenBao
  `aros/prod`) — the same access that applied the migration. An agent with that
  access (e.g. Codex) can build + verify end-to-end; `claude-code` cannot reach
  that prod surface.
- Test: an approval_gated resource action stages in approvalMatrix; a read
  resource executes inline; an unresolvable resource fails closed.
