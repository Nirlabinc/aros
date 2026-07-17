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
default surface until connect.

*(Fixed 2026-07-17: the live `/v1/demo/activation` 404 — root cause was the
route only existing on unmerged shreai#761; restored via shreai#1007 +
public-allowlist shreai#1012, patched onto the serving pm2 router, prod walk
J1 now WALKS CLEAN.)*

## J1 step 5 — 🔴 LIVE (public path): demo chat answers $0.00 from the real empty tenant

Found by the **persona walk** (fresh signup → `/start` → tap "Why are sales
down vs last week?"): the router's deterministic paths (fast-path templates,
octopus arms) ignore `demoMode`, query the live warehouse scoped to the
brand-new empty tenant, and answer **"Total Sales: $0.00"** — or worse, a raw
psql error table via `arm:sales → pos_sales_by_tender`. The sample store's
numbers never appear in chat.

**Router fix MERGED (shreai#1020, beta-E2E-verified in 5 rounds):** demo
requests skip all four deterministic families, run tools-off against the
grounded scenario context, skip the real-tenant data-access preamble, and
pin the clean instruct model. Beta answer: "Total Sales: $4,823.00 … -10.4%".
**Still broken on app.aros.live** — the public `/v1` is served by the
hand-run pm2 router (hand-patched `chat-proxy`, not transplantable); the fix
lands with the deploy-unification cutover to the launch.sh-managed router.
Related debt (real tenants, any path that reaches them):
`tool-forge/output/*` tools still shell to psql — one hardcodes PGPASSWORD —
needs the #991-style pg-client migration + a security-lane look.

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

## J4 — trend history needs a week of snapshots (by design)

The snapshotter now runs **by default** (every 6h; `STORE_SNAPSHOT_INTERVAL_MIN=0`
to opt out), so trends accrue from day one of a connected store with no
operator step. "Collecting history" remains the honest label for the first
week — that part is physics, not a defect. Verify after the next prod
deploy that the `[aros-platform] store snapshotter enabled` boot log appears.

## Structural — connect UIs share one provider catalogue; step flows still differ

Provider/field definitions are consolidated in `lib/posProviders.ts` (single
source of truth for both `/connect` and the `ConnectWizard`, incl. hints and
wire types), and the wizard now reports the REAL test outcome (failed API
test keeps the wizard open; unconfirmable tunnel says "saved — couldn't
confirm yet" instead of claiming success). Remaining: the two surfaces still
render separate step flows (page = single form; wizard = 4 steps with SCOPE/
REVIEW) — acceptable while both consume the shared catalogue, revisit if
either grows another step.

## Tooling — browser E2E runner exists; deepest live step still manual

`pnpm e2e` (Playwright) now runs: public J1 seams + draft-safety + fail-closed
checks locally against the real frontend with mocked `/api/*` (no backend, no
seeded state), and a live J2 spec against a deployed surface when
`E2E_BASE_URL`/`E2E_EMAIL`/`E2E_PASSWORD` are set. Still manual: the deepest
J2 step (a real POS connect) needs test-store credentials — until then it's
the `journey-walker` subagent's job on beta.
