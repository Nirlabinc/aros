# Walk findings — where the current build breaks the golden journeys

Grounded gaps between the journey contracts in this folder and the shipped
code, from a code-level walk + a live seam walk of app.aros.live
(2026-07-17). Each maps to a spec + step with file refs. Fix these before
calling the journey done; delete entries as they close (this file trends to
empty).

## J1 / J2 — `/start` shows fabricated data to a real signed-in user

`StartChat.tsx` force-enables demo for the *authenticated* new user (POST
`/v1/demo/enable`, every turn sends `demoMode:true` —
`apps/web/src/pages/start/StartChat.tsx:53-113`). This is the only surface
that breaks the repo's demo guarantee (`useDemo() = !session`,
`apps/web/src/redesign/data.ts:9-23`). Badged "sample data", but Ramesh's
first signed-in screen is fabricated sales. J1's contract is fine with
sample data *when labeled and expected*; the defect is it persists as the
default surface until connect, and:

- 🔴 **LIVE (prod)**: `GET /v1/demo/activation?intent=retail` → **404**
  (fetched on mount, `StartChat.tsx:74`); `/v1/demo/enable` is wired.
  Router-side drift — owned by the routing/data-wiring session, do not
  hand-patch from here.

## J2 steps 4–5 — no "we found your store" detail; readiness state machine pending

Fixed so far: in-flight "Checking with <provider>…"; success copy scoped
honestly (sync promise only for summary-capable providers, calm "connected"
otherwise); the KPI mapping drift that prevented real numbers from EVER
rendering (`buildKpis` read fields the server never returned); live data
carries a "live from <source>" marker; and `/api/store/summary`'s end-user
path now emits `hasConnector` + `summaryCapable` alongside the unchanged
strict `connected`, so Home renders four honest states (none / syncing /
connected-no-dashboard-numbers / live) instead of telling a connected owner
to "connect a register". Remaining:

- No recognizable store detail echoed on connect success (needs the test
  endpoint to return a store name / today's transaction count).
- The full readiness state machine (`store_connector_bindings.status`,
  `tenant_app_activation_status`: `waiting_for_store → syncing → ready →
  attention`) lives on the **unmerged activation-contract branch** (chat
  data-wiring session). When it merges, replace the connector-row heuristic
  behind `hasConnector`/`summaryCapable` with the real binding states.

## J4 — trend history depends on an operator activation

`changePercent` shows "collecting history" until a week of `store_snapshots`
exists — but `captureStoreSnapshots` is env-gated + scheduled
(`src/server.ts:2127`); if the operator never enables it in prod, trends stay
"collecting history" forever. Enable the snapshotter as part of tenant
activation.

## Structural — two divergent connect UIs on one API

`ConnectStorePage` (pre-onboarding, `/connect`) vs the `ConnectWizard` modal
in `AppShell` (adds SCOPE and Verifone Edge-pairing steps,
`apps/web/src/redesign/ConnectWizard.tsx:39-88`). Same
`/api/connectors` + `/test` contract, drifting step lists. Consolidate or
share step components before the next connect-flow change.

## Tooling — no browser E2E runner behind the gate

`scripts/e2e.sh` expects a `pnpm e2e` script no package defines. The seam
walk (`scripts/journey-walk.mjs`) covers HTTP-level wiring; steps marked
`NEEDS-BROWSER` have no automated runner yet — they rely on the
`journey-walker` subagent until a Playwright suite lands.
