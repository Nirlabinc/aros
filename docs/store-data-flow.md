# Store data flow — how a connected store becomes real data

The onboarding journey (`/start` demo → `/connect` → onboarding) and the
`/api/connectors` CRUD/test layer got a tenant to **"store connected"**. This
document describes how that connection turns into numbers a user and the agent
actually see — the read-back layer.

## The four stages

```
  ┌─────────────┐   ┌──────────────┐   ┌───────────────────┐   ┌──────────────┐
  │  1. CONNECT │   │  2. STORE    │   │  3. READ-BACK     │   │  4. CONSUME  │
  │  /connect   │──▶│ tenant_      │──▶│ data-service      │──▶│ dashboard    │
  │  save+test  │   │ connectors   │   │ fetchStoreSummary │   │ agent tool   │
  │             │   │ status=      │   │ (auth → pull →    │   │ (sync cache) │
  │             │   │ connected    │   │  normalize)       │   │              │
  └─────────────┘   └──────────────┘   └───────────────────┘   └──────────────┘
        DONE              DONE                THIS PR              THIS PR (1-2)
```

### 1. Connect — DONE
`/connect` page → `POST /api/connectors` (encrypt + store) → `POST
/api/connectors/test` (decrypt → bridge to vault → connector `testConnection`
→ `status=connected`). Credentials are AES-256-GCM at rest, only decrypted
in-process, never returned.

### 2. Store — DONE
`tenant_connectors` row: `{ type, name, config, credentials_encrypted,
status }`. RLS on; service-role only.

### 3. Read-back — **added here** (`connectors/data-service.ts`)
`fetchStoreSummary(record, vaultSecret)`:
- bridges decrypted secrets into the connector vault (same pattern as the test
  handler), authenticates, and pulls **today's sales** + **inventory**;
- normalizes into a typed `StoreSummary` with **defensive coercion** — unknown
  payload shapes yield an empty section flagged `partial: true`, never a
  fabricated number;
- RapidRMS is mapped today; Azure SQL / Verifone return `null` (they expose
  `query` / `fetchReports` but need a per-deployment schema/report mapping) so
  the dashboard stays on its honest placeholder.

Server helper `getTenantStoreSummary(tenantId)`:
- finds the tenant's `connected` connector (POS preferred over raw DB);
- **60s in-memory TTL cache** so a dashboard load doesn't re-auth the POS every
  request; busted immediately on connector test/delete;
- never throws — a fetch failure resolves to `null` → placeholder.

### 4. Consume
- **Dashboard** (`GET /api/dashboard`) — **wired here.** Now keys "connected?"
  off `tenant_connectors` (not the old `tenants.pos_system` guess) and, when
  connected, fills real `todaySales` + `lowStock` + a `dataSource:{live:true,…}`
  marker; otherwise the honest "Connect your store" zeros.
- **Endpoint** `GET /api/store/summary` — two auth paths:
  - **user path** — a tenant's own Supabase bearer → only their own tenant
    (dashboard uses the shared helper directly);
  - **service path** — a trusted internal caller (shre-router) presents the
    service token (`AROS_SERVICE_TOKEN`) + `X-Service-Source: shre-router` + an
    explicit `?tenantId=` (must be a UUID). This endpoint is a *trusted data
    provider*, not the tenant-authorization boundary: the caller (router) must
    have already authorized the user for that tenant. Fail-closed (no token, no
    service path); every service read is audit-logged; token compare is
    timing-safe.
- **Agent** — the router's `data-source-resolver` `aros` branch now pre-fetches
  the tenant's summary from the service path and injects it (fenced, data-only)
  into the system prompt (inert unless `AROS_APP_URL` + `AROS_SERVICE_TOKEN` are
  set). Gated by `canAccessData(agentId, tenantId, 'aros', '*')`; the fetch only
  fires for a genuine tenant **UUID** (never a prompt-derived store slug), so a
  crafted prompt cannot pull a foreign tenant's data. Non-demo AROS chat answers
  from real numbers.
- **Warehouse (`store_snapshots`)** — **added here.** A scheduled snapshotter
  (`captureStoreSnapshots`, env-gated by `STORE_SNAPSHOT_INTERVAL_MIN`, off by
  default) pulls each connected connector's summary and upserts one row per
  tenant per `business_date` into `store_snapshots` (aros Supabase). This gives
  the self-serve path **history** — so it stops being live-pull-only and
  converges with the warehouse-backed internal stores. `changePercent` is now
  computed from the same-weekday-last-week snapshot (`weekOverWeekChange`),
  null until a week of history exists.
- **CortexDB bridge** — **added here** (`connectors/cortex-bridge.ts`). Each
  snapshot is optionally replicated into the shared CortexDB warehouse as an
  `aros_store_snapshot` record (via the SDK `cortex.write` client — WAL-backed,
  circuit-broken), so self-serve connector data reaches the same cross-platform
  analytics/RAG (`/v1/rag/context`, `rapidrms.branches`) the internal stores
  get. **Opt-in** via `CORTEX_URL` / `AROS_CORTEX_BRIDGE`; **fire-and-forget**
  — a warehouse outage can never block or break the primary Supabase snapshot.
  The aros app stays authoritative; CortexDB is a downstream analytics replica.

## What is deliberately NOT done yet
- Azure SQL / Verifone summaries — need per-deployment mapping.
- A CortexDB-side reader/schema for `aros_store_snapshot` + surfacing it in the
  agent's `fetchCortexAnalytics` RAG path (the write side is wired; the read
  side is a CortexDB-repo change, validated against a live warehouse).
- `connectors/storepulse-link.ts` is superseded by DB-backed `tenant_connectors`
  and remains dead; fold its "which connectors serve this tenant" intent into
  `getTenantStoreSummary` if StorePulse needs it, rather than reviving the
  in-memory map.

## Field-mapping caveat
The RapidRMS field-name candidate lists in `data-service.ts` are defensive but
not yet validated against a **live tenant** response (no real tenant has
connected). The design fails safe: an unrecognized shape shows "live, no data
yet" (`partial`), not wrong numbers. Refine the lists once a real store
connects and its payload is observed.
