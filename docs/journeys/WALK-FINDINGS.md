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

## J2 steps 4–5 — readiness state machine pending activation-contract merge

Fixed so far: in-flight "Checking with <provider>…"; success copy scoped
honestly per provider; the KPI mapping drift that prevented real numbers
from EVER rendering; "live from <source>" marker; four honest Home states
via `hasConnector` + `summaryCapable`; and connect success now echoes a
recognizable live detail ("we found <store>: N transactions today") from
`/api/connectors/test`. Remaining:

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

## Tooling — browser E2E runner exists; deepest live step still manual

`pnpm e2e` (Playwright) now runs: public J1 seams + draft-safety + fail-closed
checks locally against the real frontend with mocked `/api/*` (no backend, no
seeded state), and a live J2 spec against a deployed surface when
`E2E_BASE_URL`/`E2E_EMAIL`/`E2E_PASSWORD` are set. Still manual: the deepest
J2 step (a real POS connect) needs test-store credentials — until then it's
the `journey-walker` subagent's job on beta.
