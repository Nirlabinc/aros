# Build brief — Item Profile plugin (retail-profiles Phase 2)

**Slug:** `g-item-profile-plugin`
**Repo of record:** `Nirlabinc/aros` (this repo). One cross-repo follow-on in
`Nirlabinc/shreai` is named in §Non-goals but is NOT part of this track.
**Executor:** Codex, assumed zero prior context on this codebase.
**Authoritative contract (read before coding, do not restate):**
`git show origin/docs/retail-profiles:docs/missions/retail-profiles.md`
`git show origin/docs/retail-profiles:docs/journeys/should-i-reorder-this.md`
(that branch is docs-only — 3 files, 405 insertions vs `origin/main`, never merged.)

---

## START HERE — most of this track is founder-blocked

Read this table before opening a file. Every "BLOCKED" row resolves in
[Stop conditions — open decisions](#stop-conditions--open-decisions-come-back-to-the-founder).

| Work | Status | Unblocked by |
|---|---|---|
| **Step 2** — pure core `src/items/{types,keys,rollup,pace,stock,profile}.ts` | **START NOW.** No schema, no I/O, no user-visible surface. | — |
| **Step 3.0** — `supabase/migrations/20260724_canonical_strong_key_rls.sql` | **START NOW.** Explicitly carved out of the journey gate: it creates no table and ships no feature, it closes a live RLS/REVOKE defect on already-merged code. | — |
| **Acceptance A** (pure unit tests) and the `canonical_strong_key` half of **D** (migration safety) | **START NOW.** They test exactly Steps 2 and 3.0. D's `entity_note` grep prints `0` until Step 3.1 lands — expected, not a failure. | — |
| **Step 0** — line-item probe | **BLOCKED. FOUNDER/OPERATOR executes it, never Codex** — it is a login against a customer's production POS. Codex's deliverable is `scripts/probe-lineitems.ts` + the expected output. | Founder answers **Q1** (who runs it, against which tenant) and pastes the stdout back |
| **Step 1** — journey spec | **BLOCKED.** `docs/journeys/should-i-reorder-this.md` is `STATUS: DRAFT`. | Founder approval — **Q3** |
| **Steps 3.1 / 3.2** — `20260724_entity_note.sql`, `20260724_item_profile.sql` | **BLOCKED.** | **Q3**; `20260724_item_profile.sql` additionally needs **Q2** (Step 0 must prove per-line item rows exist) |
| **Steps 4–10** — fetch shell, routes, activation, backfill, MCP, web, evidence | **BLOCKED.** All of it is user-visible capability behind the journey gate, and the data path is unproven. | **Q1 → Q2 → Q3**, in that order |
| **Acceptance B, C, F, G** | Blocked with the steps they test (9.2, 8, 5, 9). | as above |
| **Acceptance E** (RLS) | Runnable once Step 3 lands; needs a scratch Supabase (see §E). | — |
| **Acceptance H** (live/deployed) | **FOUNDER/OPERATOR ONLY** — requires activating the app on a real tenant. | Founder |

**Caveat on Step 2:** `rollup.ts` (`collectItemDailyRollup`, `collectBasketPairs`)
is the only part of the pure core whose *existence* depends on Q2. Write it — it
is cheap and its honesty branch (`available:false`) is what you ship if Q2 comes
back negative — but do not treat a green test suite over it as evidence the data
path exists.

---

## Track

Ship **Items**, an installable, entitlement-gated AROS app that answers one
question for a store owner standing at a shelf: *"Is this still selling, and how
many should I keep?"* — with every number traceable to a row we actually hold.

User-visible outcome: the owner installs **Items** from `/marketplace`, gets an
**Items** entry in the workspace nav at `/items`, searches or scans an item, and
reads a sentence like *"Sold 43 in the last 7 days — about 6 a day. You have 12
left: about 2 days. Keep at least 30 on the shelf."* Two plain-language controls
sit under it — **"How often should this sell?"** (item health) and **"How long do
you want to be covered?"** (2 weeks / 6 months / 1 year) — and moving the second
one visibly changes both numbers with no round trip. Where we cannot know
something, the screen says so in a sentence instead of showing a zero, an `N/A`,
or a guess.

---

## Verified ground truth

Every claim below was opened in the worktree
`C:/Users/nirpa/.shre/worktrees/aros/chat-observability` (branch
`docs/codex-build-briefs`, a clean checkout of aros `origin/main`, HEAD
`9b4a693`). Paths are repo-relative. Line numbers are from that HEAD.

### The golden-record layer is merged but has ZERO production callers

- `src/golden/resolve.ts:68` — `export async function resolveCanonical(store, input)`.
  Pure function over a `GoldenStore` port. This is the house functional-core model.
- `src/golden/resolve.ts:55` — `const STRONG_KEYS: Record<EntityType, string[]> = { product: ['upc','gtin','sku'], location: [...], customer: [...] }`.
- `src/golden/resolve.ts:71-73` — the alias registry is checked **first**:
  `findAliasCanonicalId(...)` → `outcome: 'alias_hit'`. A previously resolved
  `(source_system, source_id)` pair can never re-create a canonical.
- `src/golden/resolve.ts:101-110` — with exactly one matching canonical, a
  **conflicting** strong key (same `key_type`, different `key_value`) creates a
  fresh canonical and files a `merge_candidate`. This is the flooding hazard
  §Data contract's key rule is designed to avoid.
- `src/golden/store.ts:11` — `export function createGoldenStore(): GoldenStore`,
  the Supabase-backed implementation.
- `supabase/migrations/20260720_golden_records.sql:9,29,45,61,77,91` — tables
  `canonical_entity`, `canonical_strong_key`, `entity_alias`, `merge_candidate`,
  `negative_pair`, `merge_event`.
- `supabase/migrations/20260720_golden_records.sql:107-117` — the RLS DO-loop:
  `ENABLE ROW LEVEL SECURITY` + `<t>_sel_member` SELECT policy
  `USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid()))`
  + `GRANT SELECT ON public.<t> TO authenticated`. **Copy this exact shape.**
- `supabase/migrations/20260720_golden_records.sql:110` — the array enumerates
  five tables and **`canonical_strong_key` (created at `:29`) is not one of
  them**. **CORRECTED 2026-07-24 — an earlier revision of this brief called that
  omission "deliberate". It is not: it is a live defect**, and this track is the
  one that would first exploit it (Step 5.1 writes a strong key for **every**
  catalog row). `canonical_strong_key` has no `ENABLE ROW LEVEL SECURITY`, no
  policy and no `REVOKE` — the only golden table with no gate of any kind, and
  it holds this track's `upc`/`sku` and the Customer Profile track's `card_fp`.
  *"There is no `GRANT`, so nothing leaks"* is **not** a defence in this repo:
  four other migrations defend against Supabase's **default** privileges with an
  explicit table-level `REVOKE ALL … FROM anon, authenticated` — verified at
  `20260716_oidc_rp_sessions.sql:17`,
  `20260717_experience_routing_identity_links.sql:16,34,45`,
  `20260717_public_commerce.sql:96-98`, `20260717_terms_acceptances.sql:57` —
  and that pattern only makes sense if the defaults do grant.
  **Fixed by `supabase/migrations/20260724_canonical_strong_key_rls.sql`, which
  THIS TRACK OWNS** (§Shared migration). It sorts before every migration in this
  package's Phase 2/3 set, so no production strong key is ever written into an
  ungated table. Do not edit `20260720_golden_records.sql` in place.
- **VERIFIED ZERO CALLERS:** `resolveCanonical` and `createGoldenStore` are
  referenced only from `src/__tests__/golden-resolve.test.ts` and
  `src/__tests__/golden-store.test.ts`. The mission's C2 line "It already assigns
  canonical IDs to customer and product entities" is aspirational; the journey
  spec's own "Golden product IDs — **NOT WIRED**" is the accurate statement.
  **Item Profile is the first production consumer**, which is why the strong-key
  rule in §Data contract is a decision and not a detail.

### `skills/` is dead weight — do not import it

- `skills/src/skills/item-profiler.ts` is exactly 308 lines;
  `export class ItemProfilerSkill` is declared at line 74.
- `skills/src/index.ts:59` re-exports it, `:104` imports it, `:139`
  `new ItemProfilerSkill(),` puts it in the registry array. That registry is its
  only reference anywhere in the repo.
- `skills/package.json:2` — `"name": "@aros/skills"`. Repo-wide grep for
  `@aros/skills` (excluding `node_modules`) returns exactly 3 hits, all inside
  `skills/` itself: `skills/package.json:2`, `skills/package-lock.json:2`,
  `skills/package-lock.json:8`. Zero consumers in `src/`, `apps/`, `web/`,
  `connectors/`, `plugins/`.
- `pnpm-workspace.yaml:1-8` — `packages: packages/*, apps/*, plugins/*,
  shre-sdk, shre-model-config, mib007-live`. **`skills/` is not a workspace
  member**, so `@aros/skills` cannot be resolved by workspace protocol at all.
- `skills/src/skills/item-profiler.ts:74-120` — all aggregation lives inside one
  `async execute(context)` that starts with `await Promise.all([connector.getInvoices(...), connector.getInvoiceItems(...)])`.
  I/O and compute are mixed in one method: **not functional core** as written.
- `connectors/rapidrms/analytics-connector.ts:5-17` — header comment claims 24
  materialized views including `item_profile`, `item_performance`,
  `item_ranking`, `abc_xyz_classification`. **UNVERIFIED-BY-ME but reported by
  the recon pass as live-probed false**: only 13 matviews exist and
  `item_sales_history` is the only item one. Independent of that, the file is
  imported by nothing in production and
  `connectors/rapidrms/analytics-connector.ts:89` interpolates `this.storeId`
  directly into SQL. Do not touch, do not depend on it.

**DECIDED — item-profiler.ts disposition: HARVEST NAMED FORMULAS ONLY, leave
`skills/` byte-for-byte untouched and unreferenced.** Reimplement three ideas as
new pure functions under `src/items/`, with attribution comments:
1. `dailyVelocity = unitsSold / daySpan` (`item-profiler.ts:83-88`);
2. the `transactions: Set<string>` idiom for counting distinct receipts
   (`item-profiler.ts:99`);
3. the basket co-occurrence loop over items sharing an `invoice_no`.
Reasons: (a) the package is not a workspace member, so importing it requires
restructuring `pnpm-workspace.yaml` for one file; (b) it depends on
`connectors/rapidrms/analytics-connector.ts`, whose matviews mostly do not
exist; (c) its `ItemProfile` shape (ABC class, `peakHour`, `marginShare`) answers
a merchandising question, not "should I reorder this"; (d) its `execute()`
violates the house style. **Do not delete `skills/`** — out of scope, and
deleting a package during a hot-worktree period is gratuitous conflict.

### The MCP tool surface — 10 tools, none about items

- `apps/mcp-aros/src/tools.ts:1-12` — file header states the invariant:
  *"every advertised tool must be backed by a real AROS API route in production."*
- `apps/mcp-aros/src/tools.ts:27` `export const operatorTools` — 5 tools:
  `aros_get_store_summary` (`:29`), `aros_get_connector_health` (`:40`),
  `aros_get_inventory_risks` (`:50`), `aros_get_exception_summary` (`:60`),
  `aros_draft_action` (`:71`).
- `apps/mcp-aros/src/tools.ts:85` `export const customerTools` — 5 tools, and the
  composition is **not** "five `aros_customer_*`": `regulars_get_business_profile`
  (`:87`), `aros_customer_search_products` (`:97`),
  `aros_customer_get_promotions` (`:109`), `aros_customer_get_business_hours`
  (`:119`), `regulars_get_links` (`:129`). This surface is `noauth`
  (`:25` `regularsNoAuthSecurity`) and consumer-facing — **an item profile tool
  is operator-side, never here** (C3 patent adjacency).
- `apps/mcp-aros/src/tools.ts:153` `export function operatorToolRoute(name, args)`
  maps each operator tool to a real path (`/api/store/summary`, `/api/connectors`,
  `/api/store/inventory-risks`, `/api/store/exceptions`, `/api/human/tasks`);
  `:196` `return null` means "not implemented".
- `apps/mcp-aros/src/tools.ts:206` `const OPERATOR_TOOL_SCOPES: Record<string,string>`
  and `:214` `missingOperatorScope(name, scopes)`.
- `apps/mcp-aros/src/tools.ts:225` `export function demoResult(...)` — synthetic
  demo payloads, each tagged `source: 'synthetic_demo'` (`:233`).
- Test file that must be extended: `src/__tests__/mcp-aros-tools.test.ts`.

### How a capability reaches chat (two repos)

- `src/server.ts:5575` `const APP_CAPABILITY_BUNDLES: Record<string, AppCapabilityBundle>`
  — keys `storepulse`, `mib`, `centrix`, each listing `tools: [...]` **names only**.
- `src/server.ts:5586` `const CONNECTOR_CAPABILITY_TOOLS: Record<string, string[]>`
  — `'rapidrms-api' -> ['mib_sales_today', ...]`.
- `src/server.ts:5591` `handleWorkspaceCapabilities` serves
  `GET /api/workspace/capabilities`, gated on a service token **and**
  `x-service-source: shre-router` **and** a UUID `tenantId` query param
  (`:5597`). It returns `{ tenantId, apps, resources, tools, generatedAt }`.
  **AROS only advertises tool names — it does not implement chat tools.**
- Implementation lives in shreai: `shre-router/src/tools/aros-tools.ts:10`
  `export const arosTools = [...]`, `:402` `export const arosExecutors`.
  Registered by `shre-router/src/app-tools.ts:17`
  (`import { arosTools, arosExecutors } from './tools/aros-tools.js'`) and
  `:78` (`...arosTools,`).
- **Overlap warning:** `shre-router/src/tools/aros-tools.ts:38` already ships
  `aros_run_reorder` and `:62` `aros_run_dead_stock`. Their executors call
  `mib007Fetch('/aros/stores/<clientName>/...')` — **legacy MIB007 AROS, not this
  platform**. Shipping an item chat tool without reconciling these gives the
  owner two different reorder answers, exactly the Lightspeed failure mode the
  journey spec forbids. See §Non-goals.
  **UNVERIFIED:** whether that legacy MIB007 endpoint is still deployed and
  serving. Verifying = an authenticated call to the MIB007 host; out of bounds
  for this brief. Treat both tools as possibly-live.

### Activation model (contract C6) — real and reusable

- `supabase/migrations/20260716_manifest_provisioning.sql:8-18` —
  `provisioning_manifests(key, source_kind CHECK IN ('connector','app','plugin'),
  source_key, version, resources jsonb, active, ...)`, `UNIQUE (source_kind, source_key)`.
  **`source_kind='app'` is already permitted** — no schema change needed.
- `:52-58` `CREATE OR REPLACE FUNCTION public.apply_provisioning_manifest(p_tenant_id uuid, p_source_kind text, p_source_id text, p_manifest_key text, p_activate boolean, p_actor uuid DEFAULT NULL) RETURNS jsonb`,
  `SECURITY DEFINER SET search_path = public`.
- `:74-77` — resource `kind` must be in `channel|pos|app|agent|skill|tool|model`
  (constraint at `:4-6`).
- `:124-125` — `REVOKE ALL ... FROM PUBLIC, authenticated, anon;
  GRANT EXECUTE ... TO service_role;`
- `:130-137` — the seed-row format to copy (`'connector.rapidrms-api.v1','connector','rapidrms-api','1.0.0','[{"kind":"skill",...}]'::jsonb`).
- `supabase/migrations/20260720_embedded_marketplace_apps.sql:7-9` adds
  `platform_apps.description` and `platform_apps.embedded boolean NOT NULL DEFAULT false`;
  `:11-17` is the exact `INSERT INTO public.platform_apps(id,name,launch_url,repo,vault_namespace,required_scopes,status,description,embedded)`
  + `ON CONFLICT(id) DO UPDATE` template, with **relative** `launch_url`
  (`'/documents'`, `'/edi-invoices'`).
- `src/server.ts:2617` `async function hasActiveAppEntitlement(tenantId, appKey)`
  — reads `marketplace_app_entitlements`, `status === 'active'`, **fails closed**.
- `src/server.ts:2632` `const EDI_APP_KEY = 'edi-invoices';`
- `src/server.ts:2607` `function canManageMarketplace(role)` → `['owner','admin'].includes(role)`.
- `src/server.ts:2763` `handleMarketplaceInstall` — upserts
  `marketplace_app_entitlements` then, at `:2801`, does a **hard-coded**
  `if (appKey === DOCUMENTS_APP_KEY) await provisionDocumentsAccess(...)`.
  It does **not** call `apply_provisioning_manifest`. Step 6 fixes that generically.
- `src/server.ts:2820` `handleMarketplaceDisable` — sets status `disabled` and
  flips matching `tenant_resources` to `inactive`.
- `src/server.ts:2983` — `handleMarketplaceCatalog` reads
  `supabase.from('platform_apps').select('*').order('name')` joined against the
  tenant's entitlements. **Adding a `platform_apps` row is all it takes to make
  Items appear in the Marketplace.**

### The 409-gate pattern to copy verbatim

`src/server.ts:6097-6099` (inside `handleEdiList`, declared at `:6096`):
```ts
const auth = await authenticateRequest(req);
if (!auth) return json(res, 401, { error: 'Authentication required' });
if (!(await hasActiveAppEntitlement(auth.tenantId, EDI_APP_KEY))) return json(res, 409, { error: 'The EDI Invoices app is not installed for this workspace. Install it from the Marketplace to view supplier invoices.' });
```
Write variant adds `if (!canManageMarketplace(auth.role)) return json(res, 403, { error: 'Owner or admin role required' });`
(`src/server.ts:6115`) and an `auditLog({...})` on success (`src/server.ts:6129-6132`,
`action: 'edi.uploaded'` at `:6130`). The 401→409 ladder repeats at `:6114`, `:6144`, `:6159`.

### Route registration — a flat `if` chain in a 7,214-line file

`src/server.ts:7008-7022`:
```ts
  if (pathname === '/api/store/inventory-risks' && method === 'GET') {
    return handleStoreInventoryRisks(req, res);
  }

  if (pathname === '/api/store/exceptions' && method === 'GET') {
    return handleStoreExceptions(req, res);
  }
  if (pathname === '/api/workspace/capabilities' && method === 'GET') {
    return handleWorkspaceCapabilities(req, res);
  }
```
`src/server.ts:7026-7028` shows the prefix form used by Documents (preceded by its
section comment at `:7025`):
```ts
  if (pathname === '/api/documents' || pathname.startsWith('/api/documents/')) {
    return handleDocuments(req, res);
  }
```
**`src/server.ts` is 7,214 lines and is the most contended file in the repo.**
The `/api/items/*` addition must be that 3-line prefix form delegating to a new
module. Everything else goes in `src/items/`.

### Functional core / imperative shell — the in-repo reference for this exact domain

`connectors/data-service.ts` (858 lines):
- `:332` `export function collectInventoryRisks(rows)` — pure.
- `:419` `export function computeVoidExceptions(...)` — pure.
- `:575` `export function collectTopSoldItems(rows, limit = 10)` — pure; paired
  with the thin shell `:709 export async function fetchTopSoldItems(...)`.
- `:595` `export function collectItemChanges(rows, mode, limit)` returns
  `{ items, available, note }` and at `:638-642` returns
  `available: false, note: 'RapidRMS did not expose dedicated change timestamps
  for this field; no change list was returned rather than guessing.'`
  **This is the honesty primitive the journey spec's "absent with a reason"
  states require. Reuse the shape, not the text.**
- `:650` `export function collectInvoices(...)` — pure.
- `:542` `function flattenSalesRows(payload)` — spreads `{ ...row, ...item }` for
  nested keys `Items|items|LineItems|lineItems|InvoiceItems|invoiceItems|details|Details`,
  so invoice-level fields survive onto each line row. `INVOICE_FIELDS` at `:103`
  carries `InvoiceNo|invoiceNo|invoice_no|InvoiceNumber|...|TransactionId|InvoiceId|id`.
  **If (and only if) the payload has nested item arrays, per-invoice item lines,
  receipt counts and basket co-occurrence are all obtainable from the existing
  HTTP path with no Cortex.**
- `:178-180` `INVOICE_PAGE_SIZE = 5000`, `MAX_INVOICE_PAGES = 200`; `:182`
  `fetchInvoiceRows` throws if pagination fails to advance (`:196`) or exceeds
  200 pages (`:202`). Hard ceiling on a live pull.
- `:138` `invoiceDayBounds(fromDay, toDay)` — **every dated invoice query must use
  `T00:00:00`/`T23:59:59` bounds**; bare calendar dates return "No Data available"
  (live-verified comment at `:132-141`).
- `:826` `export async function fetchStoreSalesRange(record, vaultSecret, from, to): Promise<DailyStoreSales[]>`
  — the historical backfill shell. **It calls `fetchInvoiceRows` (`:841`), i.e.
  invoice-level rows, NOT `flattenSalesRows`.** It buckets to
  `{ businessDate, revenue, transactions }` only. Item-level data is dropped.
- `:682-707` `async function withRapidRmsSession<T>(...)` — **not exported**. A new
  item-level fetch shell must therefore live in this file (append-only) or export
  this helper. Append-only is the smaller diff; do that.
- `connectors/rapidrms-api.ts:160` `getSalesDetail` → `POST /api/SalesDetail/Get`;
  `:165` `getInvoiceReport` → `GET /api/InvoiceReport` with fallback to
  `/api/InvoiceReport/GetAllInvoiceByCreatedDate` (`:170`); `:176` `getInventory`
  → **`GET /api/Item`** (`/api/Inventory/Get` is 404, live-verified comment at `:177-179`),
  rows carry `iteM_InStock`, `iteM_MinStockLevel`, `description`, `active`, `isDeleted`.

### AROS has no read path to the Cortex warehouse

`src/server.ts:698-736` — the complete set of `../connectors/*` imports:
`rapidrms-api`, `azure-db`, `verifone/connector`, `vault-ref`, `types`,
`rapidrms-bos`, `cortex-bridge`, `mib-documents`. And
`connectors/cortex-bridge.ts:1-12` documents itself as **opt-in
(`CORTEX_URL`/`AROS_CORTEX_BRIDGE`), fire-and-forget, write-only** snapshot
replication. There is **no Cortex SELECT anywhere in the AROS server.**

### No table today can serve a per-item history

`supabase/migrations/20260715_store_snapshots.sql:12-26` — `store_snapshots` is a
daily aggregate (`revenue`, `transactions`, `low_stock_count`,
`low_stock_items jsonb`), `UNIQUE (tenant_id, business_date)`, and `:32`
`ENABLE ROW LEVEL SECURITY` with **no policy** (service-role only). Repo-wide,
`supabase/migrations/` (36 files) contains zero hits for `entity_note`,
`item_pace`, `item_stock_override`, or any `item_profile` table. **All of it is new.**

### The historical sync job — where the rollup hooks in

`src/server.ts:5664` `async function runStoreSync(jobId)`. Loop at `:5680-5695`:
chunks the date range by `job.chunk_days`, calls `fetchStoreSalesRange(...)` at
`:5683`, iterates `for (const day of daily)` at `:5684`, upserts `store_snapshots`
at `:5686`, fire-and-forgets `replicateSnapshotToCortex` at `:5688`, updates
progress at `:5694`.
`src/server.ts:5705` `handleStoreSync` — `GET` lists jobs; `POST` requires
owner/admin (`:5718`), demands a connected `rapidrms-api` connector else 409
(`:5727`), rejects a concurrent job with 409 (`:5729`), then `void runStoreSync(job.id)`
and returns `202`. The journey spec's **"Get my items now"** recovery button
points at this route.

### Web shell — four files register a section, plus the demo-mode trap

- `apps/web/src/redesign/shellData.ts:7-11` — `export type SectionKey = ... | 'edi-invoices';`
- `:37-40` — `export const EMBEDDED_APP_NAV: Record<'documents' | 'edi-invoices', NavItem>`.
- `:117` — `export const SECTIONS: Record<Exclude<SectionKey,'chat'>, SectionSpec>`.
  **TRAP:** `:118-126` the `edi-invoices` entry carries hardcoded fake rows
  (`'McLane_0714.edi'`, `'CoreMark_0713.csv'`) and fake stats. `:127-129`
  `marketplace`/`connectors`/`plugins` show the safe alternative:
  `{ eyebrow, lead, rows: [] }` with no `stats`. **Items must use the safe form.**
- `:281-285` — `export const SECTION_TITLES: Record<SectionKey, string>`.
- `apps/web/src/redesign/routes.ts:8-22` `PATH_TO_SECTION` (`'/edi-invoices': 'edi-invoices'`
  at `:13`), `:24-32` `SECTION_TO_PATH` (`'edi-invoices': '/edi-invoices'` at `:31`),
  `:34` `routeState(path)` — pure, unit-tested by `apps/web/src/redesign/routes.test.ts`.
- `apps/web/src/app/App.tsx:40` `KNOWN_PREFIXES` array; `:43-52` `ROUTE_TITLES`
  (`['/edi-invoices', 'EDI Invoices — AROS']` at `:50`). A path missing from
  `KNOWN_PREFIXES` renders a 404 for signed-out visitors (`App.tsx:170`).
- `apps/web/src/redesign/AppShell.tsx:59` `function AppInstallPrompt({ name, onBrowse })`.
- `apps/web/src/redesign/AppShell.tsx:178-190` — the embedded-app gate:
```tsx
    if (section === 'documents' || section === 'edi-invoices') {
      if (installedAppsError && installedApps === null) { /* honest error + Try again */ }
      if (installedApps === null) return <div className="rsx-panel"><div className="rsx2-empty"><div className="rsx2-empty__title">Loading…</div></div></div>;
      if (!installedApps.has(section)) {
        return <AppInstallPrompt name={EMBEDDED_APP_NAV[section].label} onBrowse={() => goSection('marketplace')} />;
      }
      if (section === 'documents') return <DocumentsPage />;
      return demo ? <SectionPanel section={section} onConnect={openWizard} /> : <EdiInvoices />;
    }
```
- Page precedents: `apps/web/src/redesign/pages/EdiInvoices.tsx`,
  `apps/web/src/redesign/pages/Documents.tsx` + `pages/documentsApi.ts`;
  stylesheets `apps/web/src/app/edi.css`, `apps/web/src/app/documents.css`.

### Test + CI infrastructure

- `vitest.config.ts` — `include: ['src/**/__tests__/**/*.test.ts', 'appfactory/**/__tests__/**/*.test.ts', 'apps/web/src/onboarding/**/*.test.ts', 'apps/web/src/redesign/routes.test.ts', 'apps/web/src/redesign/pages/connections/appsLogic.test.ts', 'apps/web/src/redesign/pages/admin/profileLogic.test.ts']`,
  `globals: true`. **A new pure test file under `src/__tests__/` is picked up
  automatically. A new pure test under `apps/web/src/redesign/` must be added to
  this `include` list explicitly.**
- `package.json` has **no generic `test` script** — run vitest directly
  (`npx vitest run <path>`). Existing scripts: `typecheck` (turbo), `e2e`
  (playwright), `check:migrations`.
- `scripts/check-migration-safety.mjs:31-41` — fails the build if a
  `CREATE TABLE public.<t>` has no `ENABLE ROW LEVEL SECURITY` anywhere in
  `supabase/migrations/`. Run `node scripts/check-migration-safety.mjs`.
- `playwright.config.ts:8,11,16,19-26` — `E2E_PORT = 5599`, `testDir: './e2e'`,
  `baseURL` = `E2E_BASE_URL` or `localhost:5599`; local mode
  starts `pnpm --filter @aros/web dev` and specs **mock `/api/*` at the network
  layer** (no backend, no seeded state); set `E2E_BASE_URL` to walk a deployed surface.
- Model spec: `e2e/install-app-from-marketplace.spec.ts` (walks `/preview/app`,
  the no-auth demo shell). Model unit test: `src/__tests__/store-risk-exception-data.test.ts`.
- `scripts/journey-walk.mjs` — the seam-level deployed walk referenced by `CLAUDE.md`.

### Data facts from the recon pass — TRUST, DO NOT RE-PROBE

These came from a read-only live probe by the verification pass. I did **not**
re-run them (no logins allowed). Treat as ground truth for design; each is
marked with what would re-verify it.

| Fact | Consequence |
|---|---|
| `rapidrms.cost_ledger`: 76,338 rows, but `uom` and `units_per_case` are **100% NULL**, `event_type` is only `sale` (63,913) / `adjustment` (12,425) — **no receive events** — and the whole table spans **2026-07-15..2026-07-23 (8 days)**. Only 2 `item_code`s show more than one distinct `unit_cost`. | Contract D3's promised sentence *"when you took 3 cases on 12 July your unit cost was $18.40 against your usual $19.60"* **cannot be produced**. `cost_ledger` is **cut from v1**. |
| Total invoice history is 2026-04-15..2026-07-23 ≈ **99 days**. | A "twice a year" item cannot show two observations. The slow-side fixture **must be synthetic**. |
| Only **3,924 of 22,178** item-master rows have ever sold; ~14,300 (65%) have zero sale lines. | "Never sold" is the **modal** outcome. The `/items` landing list and the empty state carry most of the product weight. |
| `invoice_line_item.item_code` is the POS internal item id (`'3'`, `'7346'`), **not a barcode**; joining it to `item.barcode` yields **zero** matches. Best join `item.item_id::text = li.item_code AND store_id` resolves **30,636 / 36,687 = 83.5%**. Joining on barcode fans out (40,896 rows from 36,687 lines — duplicate barcodes in the master). | Any "units sold" total **must state its resolution rate**, or it is fabricated. |
| Sample junk row: `item_code '3'`, `barcode 'WN'`, `name 'Wine'` — an open-ring department line, not a SKU. | Junk-line filtering is mandatory before any canonical is minted. |
| `store_id` skew: `client-2` = 32,471 lines, `client-180727` = 4,206, `client-181155` = **10**. `store_id == company_id`. | Perf and "looks fine locally" will be validated on `client-2` and silently break for the 10-row tenant. An empty-tenant fixture is mandatory. |
| `rapidrms.invoice_line_item` columns: `id, invoice_no, item_code, item_name, barcode, department_id, department_name, sub_dept_name, item_qty, item_amount, item_cost, discount_amount, tax_amount, total_amount, invoice_date, cashier_name, register_id, store_id, company_id, branch_id, synced_at`. | Carries `store_id` AND `company_id` AND `branch_id` — tenant scoping is possible. Also carries `cashier_name`/`register_id` — **Item Profile must never read, store or return either.** |
| `rapidrms.item`: 22,178 rows with `min_stock_level`, `max_stock_level`, `qty_on_hand`, `package_type`, `cost`, `cost_price`, `price`, `is_active`, `is_deleted`, `store_id`. | The journey spec's "show ours alongside his POS values" is fully supported. |
| **Real fast fixture (store `client-2`):** `item_code 4429` "FIRE BALL CINNEMON WISKY 50ML" — 100 distinct sale days, 567 receipts, 4,323 units. Also `10448` (97/270/484), `2970` (93/231/565). | Use verbatim as the daily-seller fixture. |
| **Real slow fixture:** `item_code 13918` "JC TEQUILA DEVILS RSV 50 ML" — 1 sale day, 15 units. Also `360` (1 day, 10 units). | Use verbatim as the **withheld-recommendation** fixture. |
| Velocity distribution across the 3,924 items that ever sold: 39 on ≥60 sale days, 1,136 on 5–20, 1,283 on 2–4, **1,168 on exactly ONE day**. | ~30% of sellers have a single sale day → the "not enough history" path is the common path, not an edge case. |

**Re-verification path for all of the above:** a read-only `psql` against the
Cortex warehouse using `readVaultJson()` from
`C:/Users/nirpa/Documents/Projects/shreai/scripts/vault-lib.mjs` (the `pg`
package is available only under `shreai/node_modules`, not in an aros worktree).

### UNVERIFIED — things Codex must confirm before relying on them

1. **Does `GET /api/InvoiceReport` return nested per-line item arrays?**
   `flattenSalesRows` (`connectors/data-service.ts:542`) only produces line rows
   if the payload has an `Items`/`LineItems`/`details`/... key. `fetchTopSoldItems`
   (`:709`) tries `getSalesDetail` first (`:722`) and falls back to
   `getInvoiceReport` (`:724`) — but the journey spec records
   `/api/SalesDetail/Get` as **404**. If InvoiceReport is header-only, **the
   entire item rollup has no source over the HTTP path**.
   *Verify:* one authenticated timed call against a real tenant connector and
   inspect the first row's keys. **This is Step 0 and is a hard gate — see
   §Implementation steps.**
2. Latency of a 90-day `/api/InvoiceReport` pull at `pageSize=5000`.
   *Verify:* the same timed call, widened to 90 days.
3. Whether `/api/Discount/SalesByPromotion` and `/Promotion` still 400/404
   (contract D3's claim). Not re-probed; needs an authenticated RapidRMS session.
4. Whether `rapidrms_analytics.item_sales_history` (29,959 rows) is refreshed on
   a schedule, and its columns (it is a matview, so columns are in `pg_attribute`,
   not `information_schema.columns`).
5. Whether shreai's `mib007Fetch('/aros/stores/...')` target is still deployed —
   i.e. whether `aros_run_reorder` / `aros_run_dead_stock` are live or dead.
6. Live behaviour of `app.aros.live` — no deployed-surface probe was made (login
   lockout risk is active), so whether the Marketplace Apps tab currently lists
   `documents`/`edi-invoices` is unconfirmed.

---

## Depends on / blocks

**Depends on (must exist before this track can ship):**
- Nothing in-repo. `canonical_entity` / `resolveCanonical()` / `createGoldenStore()`
  / `apply_provisioning_manifest()` / `platform_apps.embedded` are all merged on
  `origin/main` at HEAD `9b4a693`.
- **Founder gate (external):** `docs/journeys/should-i-reorder-this.md` is
  `STATUS: DRAFT — founder approval required before any schema`. The mission's
  Phase 1 is a GATE. **Codex must not create the migration until the orchestrator
  confirms the journey spec is approved.** If it is still DRAFT, STOP and return
  to the founder — do not "provisionally" create tables.
  **One carve-out, and only one:** `20260724_canonical_strong_key_rls.sql`
  (§Shared migration) creates no table and ships no feature — it closes a live
  RLS/REVOKE defect on a table that is already merged and already writable. It is
  outside this gate and may be raised as a standalone PR while the journey spec
  is still DRAFT. `20260724_entity_note.sql` and `20260724_item_profile.sql` are
  **not** carved out.

**Blocks:**
- `retail-profiles` Phase 3 (Customer Profile, `h-customer-profile-plugin`) —
  this track sets the **first production precedent** for binding to
  `canonical_entity`. Phase 3's C1 hashed-card key inherits whatever key
  discipline lands here.
- **`public.canonical_strong_key` RLS + REVOKE — this track owns the DDL**
  (`20260724_canonical_strong_key_rls.sql`, §Shared migration). Both this track
  (`upc`/`sku`) and the Customer Profile track (`card_fp`) write strong keys into
  that table, and it currently has no gate of any kind. **That file is NOT
  covered by this track's founder gate** — it is a security fix on merged code
  and may land first, on its own. Whichever track reaches its migration step
  first creates it byte-identically from §Shared migration; the other verifies
  and adds nothing.
- **`public.entity_note` — this track owns the DDL** (`20260724_entity_note.sql`,
  §Shared migration). The Customer Profile track writes `entity_type='customer'`
  rows into that same table and **does not re-declare it**. Both tracks' insert
  shapes are specified there. If this track's founder gate (below) is still
  closed when Customer Profile is ready to ship, Customer Profile creates that
  one file **byte-identically from §Shared migration** and this track then skips
  step 3.1 — the DDL text still has exactly one source. Never author a variant.
- `retail-profiles` Phase 4 (register name + exception types on alerts) — unrelated
  data, but sequenced after Phase 2 by the contract.
- The "repeat buyers" line of Phase 2 scope, which this track **defers into**
  Phase 3 (see §Non-goals).

**Runs in parallel with, must not collide with:** any track editing
`src/server.ts` or `apps/web/src/redesign/` (see §Collision warnings).

---

## Data contract

### Decision 1 — Data path: **an AROS-owned per-item daily rollup, filled by the existing sync path**

Three options were on the table. Choosing **(b)**:

| Option | Verdict |
|---|---|
| (a) Live RapidRMS HTTP pull per item page | **Rejected.** 90 days × `pageSize=5000` (`connectors/data-service.ts:178`) is orders of magnitude outside the journey spec's `<1.5s` P95 on 4G. |
| **(b) New AROS-owned per-item daily rollup table, filled by `runStoreSync`** | **CHOSEN.** The only option that meets the perf budget. Requires a new migration + a backfill. Reuses `src/server.ts:5664 runStoreSync`, which already chunks the range and already authenticates. |
| (c) New tenant-scoped Cortex read path | **Rejected for v1.** AROS has zero Cortex SELECT today (`src/server.ts:698-736`); the only prod code that reads `rapidrms.invoice_line_item` (`shreai: shre-router/src/tools/forge-basket-tools.ts:73`) shells out to `psql` via `execSync` with **no tenant/store filter at all** — cross-tenant by construction. Adopting it would mean new infra, new credentials, a tenant→`store_id` map, and copying an anti-pattern. Revisit only if Step 0 shows the HTTP path has no line items. |

### Decision 2 — Golden strong key: **emit exactly ONE strong key per item**

The stable handle in this data is the per-store POS item id, but `STRONG_KEYS.product`
is `['upc','gtin','sku']` (`src/golden/resolve.ts:56`). Emitting both a
store-scoped `sku` and a shared `upc` **floods `merge_candidate`**: two stores
carrying the same barcode would hit the conflict branch at
`src/golden/resolve.ts:104` (`held['sku'] !== incoming sku`) on every ingest.

**Rule (pure function `itemMatchKeys()`):**
- If the barcode is *clean* — non-empty, `/^[0-9]{8,14}$/`, and **unique within
  that tenant's catalog snapshot** — emit `{ upc: barcode }` and nothing else.
  Barcoded items then merge across stores, which is the desired behaviour.
- Otherwise emit `{ sku: `${storeId}:${itemCode}` }` and nothing else.
- Never emit both. Never emit `gtin`.

Stability is guaranteed by the alias registry, not the strong key:
`entity_alias` is keyed on `(source_system='rapidrms', source_id='${storeId}:${itemCode}')`
and is checked first (`src/golden/resolve.ts:71-73`). So an item that first
resolves on `sku` (dirty barcode) and later gets a clean barcode still
`alias_hit`s to the same canonical — it does not fork.

**Junk-line filter (pure `isProfilableItem()`), applied BEFORE any resolve call:**
skip rows where the item code is absent; where the row does not match an
`item_catalog_snapshot` entry; where `is_deleted` is true; or where
`department_name` marks an open-ring/department key. Un-resolvable sale lines are
**counted in a `unresolvedLines` figure and surfaced**, never silently dropped and
never minted as canonicals.

### Decision 3 — the word "deal" leaves Item Profile entirely

`skills/src/skills/deal-hunter.ts` already owns "deal" and owns it broadly — its
header reads *"Scans vendor promotions, close-out deals, and bulk discounts…
cross-references each deal against actual sales velocity"*, with fields
`regularCost/promoCost/savingsPct/dailyVelocity/daysOfStockIfBought/overstockRisk/suggestedOrderQty/promoStart/promoEnd`
and `MAX_STOCK_DAYS=60`. That is ~90% of contract D3's "tiered bulk vendor promo"
minus the tier ladder. Renaming one side does not resolve a concept collision.

**Decision:** Item Profile never uses the word "deal". Its supply block is titled
**"How it comes in"** and is sourced *only* from the already-shipped **EDI
Invoices** app (`connectors/rapidrms-edi.ts`, surfaced by
`apps/web/src/redesign/pages/EdiInvoices.tsx`, whose `EdiItemDetail` type carries
`itemNo, upc, caseUPC, caseCost, packCost, caseQty, caseQtyReceived`).
`rapidrms.cost_ledger` is **not read** — it cannot evidence what D3 promised.
`deal-hunter.ts` is untouched and keeps sole ownership of the word.

### Shared migration — `supabase/migrations/20260724_canonical_strong_key_rls.sql` — **THIS TRACK OWNS IT**

**This is a security fix, not a feature, and it is the first file this package
lands.** `public.canonical_strong_key` (`20260720_golden_records.sql:29`) was
omitted from that migration's RLS/GRANT DO-loop (`:110`, five tables named) and
therefore has **no RLS, no policy and no REVOKE** — the only golden table with no
gate of any kind. This track's Step 5.1 calls `resolveCanonical` for **every**
catalog row, which writes `upc`/`sku` strong keys; the Customer Profile track
writes `card_fp` there. Neither may put a production row into that table until
this file has landed.

**It is deliberately NOT inside `20260724_item_profile.sql` and NOT inside
`20260725_customer_profile.sql`.** Both of those are gated on founder decisions
(this track's journey-spec gate; that track's Q1/Q2/Q9/Q13). A gate on a feature
must not hold a gate on a security defect, so the fix lives in its own file that
can be reviewed and merged on its own, ahead of both. Same single-owner pattern
as `entity_note` below: **one declaration, one owner, sorts first.**

**Do not edit `20260720_golden_records.sql`.** The fix is additive so history
stays replayable — the house rule everywhere else in this repo.

```sql
-- ── SECURITY FIX: gate public.canonical_strong_key ──────────────────────────
-- Owner of this DDL: g-item-profile-plugin (retail-profiles Phase 2).
-- Consumers: Item Profile (upc/gtin/sku) and Customer Profile (card_fp,
-- h-customer-profile-plugin). DO NOT re-declare any of this in another
-- migration — edit it here or not at all.
--
-- DEFECT: 20260720_golden_records.sql:107-117 enables RLS + a member SELECT
-- policy + GRANT SELECT on canonical_entity, entity_alias, merge_candidate,
-- negative_pair and merge_event. canonical_strong_key (created at :29) is
-- absent from that array, so it shipped with no RLS, no policy and no REVOKE.
-- It is the atomic dedup backstop and it holds tenant-scoped strong keys.
--
-- "There is no GRANT, so nothing leaks" is NOT a valid defence in this repo:
-- four other migrations explicitly revoke Supabase's DEFAULT privileges from
-- anon/authenticated — 20260716_oidc_rp_sessions.sql:17,
-- 20260717_experience_routing_identity_links.sql:16,34,45,
-- 20260717_public_commerce.sql:96-98, 20260717_terms_acceptances.sql:57.
-- That pattern only makes sense if the defaults DO grant. So this file does
-- BOTH: the policy (the backstop for the day a grant is added deliberately)
-- AND the REVOKE (which removes any default privilege that exists today).

ALTER TABLE public.canonical_strong_key ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS canonical_strong_key_sel_member ON public.canonical_strong_key;
CREATE POLICY canonical_strong_key_sel_member ON public.canonical_strong_key FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid()));

-- No GRANT. Reads and writes go through the service role in the app layer,
-- exactly like every other golden table's write path.
REVOKE ALL ON public.canonical_strong_key FROM anon, authenticated;
```

**Merge gate — one declaration, exactly as for `entity_note`:**

```
grep -rln "ALTER TABLE public.canonical_strong_key ENABLE ROW LEVEL SECURITY" supabase/migrations/ | wc -l
```
must print `1`. `scripts/check-migration-safety.mjs` **cannot** catch a second
declaration — verified at `:24-25`, it `readFileSync`s every `*.sql` and
`.join('\n')`s them into a single string before matching, so N copies and one
copy look identical to it. (Its RLS rule is also satisfied here only by
accident: the 4,000-character proximity regex at `:37-38` already matched the
neighbouring DO-block in `20260720_golden_records.sql`, which is why the lint
never flagged the original defect. Do not treat a green `check:migrations` as
evidence about this table.)

**Whichever track reaches its migration step first creates this file**, copied
byte-for-byte from this section, under this exact filename; the other verifies it
is present and adds nothing. If it is present but its text differs from this
section, **STOP** and reconcile to this section — do not add a second file.

### Shared migration — `supabase/migrations/20260724_entity_note.sql` — **THIS TRACK OWNS IT**

`public.entity_note` is **not an Item Profile table**. It is the one note box
shared with the Customer Profile track (`h-customer-profile-plugin`,
retail-profiles Phase 3), which stores notes on *customer* canonical entities.

**This brief is the single owner of this DDL.** H does not re-declare it — H's
migration contains no `CREATE TABLE … entity_note` at all and depends on this
file (H §Collision warnings, H Step 2). If you change one byte of this block you
must also raise it with the Customer Profile track before merging; a second
divergent `CREATE TABLE IF NOT EXISTS` for this table is a **silent no-op** at
apply time and a **runtime** insert failure for whichever track landed second.
That exact defect was found in this package's review (finding #1) and this
section is its resolution.

It is a **separate file** so that it sorts before both consumers and can land
independently of either track's founder gate:

```
20260724_canonical_strong_key_rls.sql  ← security fix (owner: track G, below)
20260724_entity_note.sql               ← this file (owner: Item Profile / track G)
20260724_item_profile.sql              ← Item Profile's own tables
20260725_customer_profile.sql          ← Customer Profile (renamed to sort after)
```

Lexical order is what enforces that sequence (`c` < `e` < `i`, then `20260725`);
**do not rename any of these four files** without re-checking it.

**These four are a subset.** The package introduces **seven** migrations across
five tracks, and the single authoritative applied order — with each file's owner
and what it must sort after — is `README.md` § **"Migration apply order"**. In
full: `20260724_canonical_strong_key_rls.sql` (G) → `20260724_chat_eval_heartbeat.sql`
(E) → `20260724_chat_transcripts.sql` (A) → `20260724_entity_note.sql` (G) →
`20260724_item_profile.sql` (G) → `20260725_chat_grades.sql` (F) →
`20260725_customer_profile.sql` (H). No two tracks declare the same filename;
this track is the only declarer of the first, fourth and fifth. If you rename
one, re-derive that README table in the same PR.

```sql
-- ── SHARED: entity_note — the free-text owner note box ──────────────────────
-- Owner of this DDL: g-item-profile-plugin (retail-profiles Phase 2).
-- Consumers: Item Profile (entity_type='product') and Customer Profile
-- (entity_type='customer', h-customer-profile-plugin). DO NOT re-declare this
-- table in any other migration — edit it here or not at all.
--
-- Polymorphic by design: `entity_key` is the caller's own stable key, so a note
-- can hang off an item that has not been canonicalised yet, and `canonical_id`
-- is an optional cross-reference, not the identity.
--   product  -> entity_key = source_item_key  (`${storeId}:${itemCode}`)
--   customer -> entity_key = canonical_id::text
-- No PII, no PAN, no cardholder name — `body` is owner-authored free text and is
-- rendered back only to members of the owning tenant.

CREATE TABLE IF NOT EXISTS public.entity_note (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('product','customer')),
  entity_key text NOT NULL,
  canonical_id uuid REFERENCES public.canonical_entity(id) ON DELETE SET NULL,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Item Profile keeps exactly ONE note per item; Customer Profile keeps MANY per
-- card. So the uniqueness is PARTIAL, not table-wide — a table-wide
-- UNIQUE (tenant_id, entity_type, entity_key) would make H's second note on a
-- card fail at runtime.
CREATE UNIQUE INDEX IF NOT EXISTS uq_entity_note_product
  ON public.entity_note(tenant_id, entity_key)
  WHERE entity_type = 'product';

CREATE INDEX IF NOT EXISTS idx_entity_note_lookup
  ON public.entity_note(tenant_id, entity_type, entity_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_entity_note_canon
  ON public.entity_note(tenant_id, canonical_id, created_at DESC);

-- RLS in this same file (check-migration-safety.mjs:31-41). Member SELECT only;
-- every write goes through the service role, same shape as
-- 20260720_golden_records.sql:107-117.
ALTER TABLE public.entity_note ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS entity_note_sel_member ON public.entity_note;
CREATE POLICY entity_note_sel_member ON public.entity_note FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid()));
GRANT SELECT ON public.entity_note TO authenticated;

DROP TRIGGER IF EXISTS touch_entity_note ON public.entity_note;
CREATE TRIGGER touch_entity_note BEFORE UPDATE ON public.entity_note
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
```

**Both tracks' write shapes, valid against exactly this DDL.** Reproduce these
verbatim; neither is a PostgREST `.upsert()`, because a partial unique index is
not a valid `ON CONFLICT` inference target for PostgREST's `on_conflict=`
parameter (Postgres can only infer a partial index when the statement repeats
the index predicate).

- **Item Profile — `PUT /api/items/:sourceItemKey/note`** (one note per item, in
  `src/items/service.ts`, service role). A non-empty body is an update-then-insert:

  ```ts
  // trimmed body; '' (or whitespace only) means "clear the note" -> DELETE.
  const key = { tenant_id: tenantId, entity_type: 'product', entity_key: sourceItemKey };
  if (!body) { await db.from('entity_note').delete().match(key); return null; }
  const upd = await db.from('entity_note')
    .update({ body, created_by: userId }).match(key).select().maybeSingle();
  const row = upd.data ?? (await db.from('entity_note')
    .insert({ ...key, canonical_id: canonicalId ?? null, body, created_by: userId })
    .select().single()).data;   // 23505 on a concurrent insert -> re-run the update
  ```
  `uq_entity_note_product` is the integrity backstop for that race — on a
  `23505` unique violation, re-run the `update` and return its row.

- **Customer Profile — `POST /api/customers/cards/:canonicalId/notes`** (many
  notes per card, `src/customers/service.ts`, service role):

  ```ts
  await db.from('entity_note').insert({
    tenant_id: tenantId, entity_type: 'customer',
    entity_key: canonicalId,          // canonical_id::text — the customer's stable key
    canonical_id: canonicalId, body, created_by: userId,
  }).select('id, body, created_at').single();
  ```
  `DELETE /api/customers/notes/:noteId` deletes by
  `{ id: noteId, tenant_id: tenantId, entity_type: 'customer' }` — always
  tenant-scoped, never by `id` alone.

**Why these choices, since both briefs previously disagreed:**

| Column | Settled | Why |
|---|---|---|
| `entity_type` | `NOT NULL CHECK (…IN ('product','customer'))` | Present in G, absent in H. One table serving two entity kinds needs the discriminator; the CHECK is widened now rather than in a Phase-3 `ALTER`. |
| `entity_key` | `text NOT NULL` | Item notes must be writable before an item is canonicalised. Customers set it to `canonical_id::text`. |
| `canonical_id` | **nullable**, `ON DELETE SET NULL` | H had `NOT NULL`/`CASCADE`. Nullable is required for the pre-canonical item case, and `SET NULL` matches both briefs' Rollback rule that owner-authored text is never destroyed. Reads key on `entity_key`, which survives. |
| `body` | `char_length(body) BETWEEN 1 AND 2000` | H's check; G's `length(body) <= 2000` permitted an empty-string note. Clearing a note is a `DELETE`, not an empty row. |
| `created_by` | `uuid REFERENCES auth.users(id) ON DELETE SET NULL` | H's shape; well-precedented (`20260714_tenant_connectors.sql:16`, `20260715_setup_resources.sql:13`). G's bare `uuid` was weaker for no benefit. |
| uniqueness | partial unique index on products only | G needed an upsert target; H needs many rows per card. A table-wide UNIQUE breaks H. |

**`body` is owner-typed free text — run it through the package's ONE PAN
redactor before insert.** The DDL comment says "no PII, no PAN", but nothing
stops an owner typing *"customer's card 4111 1111 1111 1111 kept declining"* into
a note. Both write paths above (`PUT /api/items/:sourceItemKey/note` and
`POST /api/customers/cards/:canonicalId/notes`) must apply
`redactPan(body.trim())` **before** the `insert`/`update`, importing it from
`src/chat/redact.ts` — the single owner, spec in `d-actionable-errors.md` §Data
contract **6a** (Luhn-gated, marker `'[redacted-card]'`, fixtures in
`src/chat/__fixtures__/pan-redaction.json`). **Do not write a second PAN rule
here**; forking a shared safety primitive is a stop condition, and it is exactly
what the review caught three other briefs doing. If `src/chat/redact.ts` has not
landed yet, create it exactly as §6a specifies. Add one unit test: a note body
containing a Luhn-valid PAN is stored redacted, and a body containing
`'sku 123456789012'` is stored byte-identical.

**Actor stamp — inherited, not invented (ai-activity-spine).** `created_by` is
the **only** actor field on `entity_note` and it is filled from the
server-resolved authenticated user, never from the request body; `tenant_id` is
the tenant that user is an active member of. Read
`COORDINATION-ai-activity-spine.md` and `a-conversation-persistence.md`
§ "Bind to the AI activity spine": AROS has exactly **one** attribution path —
`tenant_id` (= the spine's `workspace_id`) + the acting `user_id` (=
`actor_user_id`), FK-enforced. This track binds to it and adds nothing: **no
actor table, no AI-activity feed, and no conversation/turn store.** Any AI turn
this track's MCP tools or chat capability produces is persisted by **track A**,
in its append-only per-message rows — Centrix's blob + 30-minute-TTL shape is
adopted for attribution only and rejected for persistence. If a design pressure
here wants to record "which agent asked for this item" anywhere other than
track A's tables, **stop** — that is the second-attribution-path stop condition.

### Migration — `supabase/migrations/20260724_item_profile.sql`

Single migration for this track's **own** tables (`entity_note` is not one of
them — see the shared migration above). RLS in the same file, per C5 and
enforced by `scripts/check-migration-safety.mjs`. **No PAN, no cardholder data,
no `cashier_name`, no `register_id` anywhere in these tables.**

```sql
-- Item Profile (retail-profiles Phase 2). Per-item daily rollup + owner controls.
-- Reads are tenant-member SELECT via RLS; ALL writes go through the service role
-- in src/items/service.ts with server-enforced RBAC (owner/admin), matching
-- 20260720_golden_records.sql. No PCI data and no employee attribution
-- (cashier_name / register_id) is stored here, by design.

-- ── item_catalog_snapshot: the item master we can search and price against ──
CREATE TABLE IF NOT EXISTS public.item_catalog_snapshot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  connector_id uuid REFERENCES public.tenant_connectors(id) ON DELETE SET NULL,
  canonical_id uuid REFERENCES public.canonical_entity(id) ON DELETE SET NULL,
  source_item_key text NOT NULL,          -- `${storeId}:${itemCode}` — stable, 100% resolvable
  store_id text NOT NULL,
  item_code text NOT NULL,
  barcode text,                           -- may be junk ('WN'); never assumed unique
  display_name text NOT NULL,
  department text,
  on_hand numeric,                        -- NULL = unknown, never 0-as-unknown
  pos_min_stock numeric,                  -- his register's own min, shown alongside ours
  pos_max_stock numeric,
  price numeric,
  cost numeric,
  is_active boolean NOT NULL DEFAULT true,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  captured_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, source_item_key)
);
CREATE INDEX IF NOT EXISTS idx_item_catalog_tenant_name
  ON public.item_catalog_snapshot(tenant_id, display_name);
CREATE INDEX IF NOT EXISTS idx_item_catalog_tenant_barcode
  ON public.item_catalog_snapshot(tenant_id, barcode);

-- ── item_daily_sales: THE perf backbone. One row per item per business day. ──
CREATE TABLE IF NOT EXISTS public.item_daily_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  connector_id uuid REFERENCES public.tenant_connectors(id) ON DELETE SET NULL,
  canonical_id uuid REFERENCES public.canonical_entity(id) ON DELETE SET NULL,
  source_item_key text NOT NULL,
  business_date date NOT NULL,
  units numeric NOT NULL DEFAULT 0,
  net_sales numeric NOT NULL DEFAULT 0,
  cost_total numeric NOT NULL DEFAULT 0,
  receipts integer NOT NULL DEFAULT 0,    -- DISTINCT invoice numbers that day
  captured_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, source_item_key, business_date)
);
CREATE INDEX IF NOT EXISTS idx_item_daily_tenant_item_date
  ON public.item_daily_sales(tenant_id, source_item_key, business_date DESC);
CREATE INDEX IF NOT EXISTS idx_item_daily_tenant_date
  ON public.item_daily_sales(tenant_id, business_date DESC);

-- ── item_basket_pair: "usually bought with", per rolled-up window ──
CREATE TABLE IF NOT EXISTS public.item_basket_pair (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  source_item_key text NOT NULL,
  paired_item_key text NOT NULL,
  paired_display_name text,
  co_receipts integer NOT NULL DEFAULT 0,
  window_from date NOT NULL,
  window_to date NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT item_basket_pair_distinct CHECK (source_item_key <> paired_item_key),
  UNIQUE (tenant_id, source_item_key, paired_item_key, window_from, window_to)
);
CREATE INDEX IF NOT EXISTS idx_item_basket_lookup
  ON public.item_basket_pair(tenant_id, source_item_key, co_receipts DESC);

-- ── item_pace: owner control 1 ("How often should this sell?") ──
-- scope='item'       -> scope_key = source_item_key
-- scope='department' -> scope_key = department name (one-tap "all of Wine")
CREATE TABLE IF NOT EXISTS public.item_pace (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('item','department')),
  scope_key text NOT NULL,
  pace text NOT NULL CHECK (pace IN ('daily','weekly','monthly','seasonal')),
  set_by uuid,
  set_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, scope, scope_key)
);

-- ── item_stock_override: "Not right? Set it yourself" — his numbers always win ──
CREATE TABLE IF NOT EXISTS public.item_stock_override (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  source_item_key text NOT NULL,
  min_units integer NOT NULL CHECK (min_units >= 0),
  max_units integer NOT NULL CHECK (max_units > 0),
  set_by uuid,
  set_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT item_stock_override_ordered CHECK (min_units < max_units),
  UNIQUE (tenant_id, source_item_key)
);

-- ── entity_note is NOT created here. ────────────────────────────────────────
-- The free-text note box (contract Phase 2 names the table) is shared with the
-- Customer Profile track and lives in 20260724_entity_note.sql, which sorts
-- before this file. Do not add a second CREATE TABLE for it — see the shared
-- migration section of this brief.

-- ── RLS: member SELECT only; every write goes through the service role. ──────
-- Same shape as 20260720_golden_records.sql:107-117.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['item_catalog_snapshot','item_daily_sales','item_basket_pair','item_pace','item_stock_override'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_sel_member ON public.%I', t, t);
    EXECUTE format($f$CREATE POLICY %I_sel_member ON public.%I FOR SELECT
      USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid()))$f$, t, t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
  END LOOP;
END $$;

-- ── Activation (contract C6): marketplace app row + provisioning manifest ────
-- Template: 20260720_embedded_marketplace_apps.sql:11-17
INSERT INTO public.platform_apps(id,name,launch_url,repo,vault_namespace,required_scopes,status,description,embedded) VALUES
('items','Items','/items','Nirlabinc/aros/apps/web','shre/aros/items',ARRAY['items:read','items:write'],'active','Look up any item: how it''s selling, what it sells with, and how much to keep on the shelf.',true)
ON CONFLICT(id) DO UPDATE SET
  name=EXCLUDED.name, launch_url=EXCLUDED.launch_url, repo=EXCLUDED.repo,
  vault_namespace=EXCLUDED.vault_namespace, required_scopes=EXCLUDED.required_scopes,
  status=EXCLUDED.status, description=EXCLUDED.description, embedded=EXCLUDED.embedded;

-- Template: 20260716_manifest_provisioning.sql:130-137. source_kind 'app' is
-- already permitted by the CHECK at 20260716_manifest_provisioning.sql:10.
INSERT INTO public.provisioning_manifests(key,source_kind,source_key,version,resources) VALUES
('app.items.v1','app','items','1.0.0','[
 {"kind":"app","provider":"aros","name":"Items","capabilities":["items.read","items.write"]},
 {"kind":"tool","provider":"aros","name":"Item Profile","capabilities":["items.read"]}
]'::jsonb)
ON CONFLICT (key) DO UPDATE SET version=EXCLUDED.version,resources=EXCLUDED.resources,active=true,updated_at=now();

-- NO grandfathering (matches 20260720_embedded_marketplace_apps.sql:19-23):
-- every tenant installs Items explicitly from the Marketplace.
```

### Pure domain types — `src/items/types.ts`

```ts
export type Pace = 'daily' | 'weekly' | 'monthly' | 'seasonal';
export type Horizon = '2w' | '6m' | '1y';
export type Health = 'selling_fine' | 'slowing_down' | 'stalled';

/** Rules as declarative data (house style), not branches. */
export const PACE_RULES: Record<Pace, {
  label: string;              // exactly the owner-facing words from the journey spec
  expectedIntervalDays: number;
  restockCycleDays: number;   // drives "keep at least N"
  defaultHorizon: Horizon;
}> = {
  daily:    { label: 'Every day',          expectedIntervalDays: 1,   restockCycleDays: 5,   defaultHorizon: '2w' },
  weekly:   { label: 'Every week',         expectedIntervalDays: 7,   restockCycleDays: 14,  defaultHorizon: '2w' },
  monthly:  { label: 'Every month',        expectedIntervalDays: 30,  restockCycleDays: 45,  defaultHorizon: '6m' },
  seasonal: { label: 'A few times a year', expectedIntervalDays: 120, restockCycleDays: 182, defaultHorizon: '6m' },
};

export const HORIZON_DAYS: Record<Horizon, number> = { '2w': 14, '6m': 182, '1y': 365 };

export interface DayPoint { businessDate: string; units: number; receipts: number; netSales: number; }

/** Absent-with-a-reason. Mirrors collectItemChanges (connectors/data-service.ts:638). */
export type Withheld = { available: false; reason:
  | 'never_sold' | 'not_enough_history' | 'on_hand_unknown'
  | 'line_items_unavailable' | 'owner_set'; note: string };

export interface StockGuidance {
  available: true;
  minUnits: number;
  maxUnits: number;
  capped: boolean;
  capReason?: string;
  source: 'calculated' | 'owner';
  setAt?: string;          // present when source === 'owner'
  basis: string;           // ALWAYS shown: "Based on selling about 6 a day for the last 90 days."
}
```

### Pure function signatures — `src/items/`

```ts
// src/items/keys.ts
export function sourceItemKey(storeId: string, itemCode: string): string;             // `${storeId}:${itemCode}`
export function isCleanBarcode(barcode: string | null | undefined): boolean;          // /^[0-9]{8,14}$/
export function itemMatchKeys(i: { storeId: string; itemCode: string; barcode?: string | null; barcodeIsUniqueInTenant: boolean }): Record<string, string>;
export function isProfilableItem(row: { itemCode?: string; departmentName?: string; isDeleted?: boolean; inCatalog: boolean }): boolean;

// src/items/rollup.ts  — harvested from skills/src/skills/item-profiler.ts (see §Verified ground truth)
export function collectItemDailyRollup(lineRows: Array<Record<string, unknown>>, from: string, to: string):
  { rows: Array<{ sourceItemKey: string; businessDate: string; units: number; netSales: number; costTotal: number; receipts: number }>;
    available: boolean; note?: string; totalLines: number; unresolvedLines: number };
export function collectBasketPairs(lineRows: Array<Record<string, unknown>>, limitPerItem?: number):
  { pairs: Array<{ sourceItemKey: string; pairedItemKey: string; pairedDisplayName: string; coReceipts: number }>;
    available: boolean; note?: string };

// src/items/pace.ts
export function suggestPace(days: DayPoint[], windowDays: number): { pace: Pace; sentence: string } | null;  // null = not enough history
export function classifyHealth(pace: Pace, daysSinceLastSale: number | null): Health | Withheld;

// src/items/stock.ts
export function computeStockGuidance(i: {
  days: DayPoint[]; windowDays: number; pace: Pace; horizon: Horizon;
  posMaxStock: number | null; override: { minUnits: number; maxUnits: number; setAt: string } | null;
}): StockGuidance | Withheld;
export function validateOverride(minUnits: number, maxUnits: number): { ok: true } | { ok: false; field: 'minUnits' | 'maxUnits'; message: string };
export function daysOfCover(onHand: number | null, unitsPerDay: number): number | Withheld;

// src/items/profile.ts — composes everything above. Zero I/O.
export function assembleItemProfile(input: ItemProfileInput): ItemProfileResponse;
```

**The stock model, stated once (one model only — the journey spec forbids
shipping min/max *and* a separate reorder point):**

```
observedDays = windowDays clamped to the days we actually hold
unitsPerDay  = sum(units) / observedDays
minUnits     = max(1, ceil(unitsPerDay * PACE_RULES[pace].restockCycleDays))
maxUnits     = max(minUnits + 1, ceil(unitsPerDay * HORIZON_DAYS[horizon]))
cap          = posMaxStock when > 0; if maxUnits > cap -> maxUnits = cap, capped = true
```
**Round the product to 6 decimals before `ceil`.** Raw `ceil` on a float product
tips whole numbers up: `43/7*14 === 86.00000000000001` → 87, not 86. Define
`const up = (x: number) => Math.ceil(Number(x.toFixed(6)));` and use it for both
lines. All fixture values below and in Acceptance A are stated under this rule.
Sanity check against the journey spec's own worked example: 43 units / 7 days =
6.14/day, `daily` pace → `min = ceil(6.14 * 5) = 31` ≈ its "Keep at least 30",
and 2-week horizon → `max = ceil(6.14 * 14) = 86` ≈ its "2 weeks of sales would
be 84". Round the displayed velocity, not the math.

**Withholding rules (these are what make the model honest):**
- zero sale rows in the window → `{ available:false, reason:'never_sold' }`
- `observedDays < 14` **or** distinct sale days `< 2` →
  `{ available:false, reason:'not_enough_history' }`
- `onHand === null` → days-of-cover is `{ available:false, reason:'on_hand_unknown' }`
  while velocity and min/max still render
- an `item_stock_override` row exists → `source:'owner'`, `setAt`, and the math
  is **not** shown (`"You set these on 22 July"`)

Founder's required pair, both under the same control:
- fast (real fixture `4429`): 4,323 units / 100 sale days = 43.23/day → `daily`,
  2w → min = 217, max = 606. Sensible. (These are the exact integers Acceptance
  A.1 asserts; computed, not estimated.)
- slow (**synthetic** fixture — 99 days of real history cannot contain a
  twice-a-year item): 2 units across 2 sale days spanning 365 days → `seasonal`,
  1y → `unitsPerDay = 0.0055`, min = `max(1, ceil(0.998)) = 1`, max =
  `max(2, ceil(2.0)) = 2`. Sensible, and health at 40 days since last sale is
  `selling_fine` (40 ≤ 120), **not** "stalled". That is the founder's core requirement.
- real slow fixture `13918` (1 sale day) → guidance **withheld** with
  `reason:'not_enough_history'`. Also required.

### HTTP contract

All routes: `401` unauthenticated → `409` when the `items` app is not installed
(plain-language install message) → `403` on writes when
`!canManageMarketplace(auth.role)` → `auditLog` on every mutation.

```
GET /api/items?query=<str>&limit=<1..100>&cursor=<str>
200 {
  connected: boolean,                    // false => "We haven't pulled your item list yet."
  items: Array<{ sourceItemKey, displayName, department, barcode|null,
                 onHand|null, health: Health|null, lastSoldAt|null }>,
  shortlists: {
    runningOutSoon: Array<{ sourceItemKey, displayName, onHand, daysLeft }>,
    hasntSoldInAWhile: Array<{ sourceItemKey, displayName, lastSoldAt|null }>
  },
  lineItemsAvailable: boolean,           // false => the "your register doesn't break invoices down" state
  asOf: string,                          // ISO — drives "as of 9:40 AM" + Check now
  nextCursor: string|null
}
409 { error: "The Items app is not installed for this workspace. Install it from the Marketplace to look up how your items are selling." }

GET /api/items/:sourceItemKey?window=90
200 {
  item: { sourceItemKey, canonicalId|null, displayName, department, barcode|null,
          onHand|null, posMinStock|null, posMaxStock|null, price|null, cost|null },
  sales: { windowDays: number, observedDays: number, unitsSold: number,
           unitsPerDay: number, receipts: number, lastSoldAt: string|null,
           series: DayPoint[],                     // the 90-day bar chart
           resolutionRate: number,                 // 0..1 — MUST be rendered when < 0.95
           available: boolean, note?: string },
  pace: { current: Pace, source: 'owner'|'suggested'|'default',
          suggestion: { pace: Pace, sentence: string } | null },
  health: Health | Withheld,
  guidance: {                                      // ALL THREE precomputed -> horizon toggle is a pure client re-render, <100ms, zero round trip
    '2w': StockGuidance | Withheld,
    '6m': StockGuidance | Withheld,
    '1y': StockGuidance | Withheld,
    defaultHorizon: Horizon
  },
  daysOfCover: number | Withheld,
  boughtWith: { pairs: Array<{ sourceItemKey, displayName, coReceipts }>, available: boolean, note?: string },
  repeatBuyers: { available: false, note: "We can't tell you yet whether the same person came back — that needs the Customer Profile app." },
  note: { body: string, updatedAt: string } | null,
  asOf: string
}

PUT    /api/items/:sourceItemKey/pace    { pace: Pace, applyTo: 'item'|'department' }  -> 200 { pace, appliedTo, scopeKey }
PUT    /api/items/:sourceItemKey/stock   { minUnits: number, maxUnits: number }        -> 200 { guidance } | 400 { field, message }
DELETE /api/items/:sourceItemKey/stock                                                  -> 200 { guidance }   // back to calculated
PUT    /api/items/:sourceItemKey/note    { body: string }                               -> 200 { note }   // note: {body,updatedAt}|null; body trimmed, 1..2000 chars, '' => cleared (row DELETEd, note:null)
GET    /api/items/:sourceItemKey/supply                                                 -> 200 { available, deliveries?: [...], note? }
POST   /api/items/rollup                 { months?: number }                            -> 202 { job }  // delegates to the existing runStoreSync
```

`GET /api/items/:key/supply` is a **separate, lazily fetched** endpoint precisely
so the item page's first paint is not blocked by a live EDI HTTP round trip.
When the tenant has no active `edi-invoices` entitlement it returns
`200 { available: false, note: 'Turn on EDI Invoices to see which delivery this came in on.' }`
— never a 409, because the item page itself is installed and working.

### Client props

`apps/web/src/redesign/pages/Items.tsx` holds the fetched
`ItemProfileResponse` in state. The horizon control changes a local
`Horizon` state and reads `guidance[horizon]` — **no fetch**. The pace control is
a write, so it does round-trip and then refetches the profile.

---

## Implementation steps

Ordered. **Steps 0 and 1 are gates.** Parallelism is called out per step.

### Step 0 — GATE: prove line items exist before writing any schema — **[FOUNDER/OPERATOR-EXECUTED]**

**Codex does not run this probe.** Obtaining a "RapidRMS session" means calling
`rapidRms.authenticate()` → `POST {baseUrl}/api/Login/Auth` with a live tenant's real POS
username and password (`connectors/rapidrms-api.ts:11-32`), decrypted out of
`tenant_connectors.credentials_encrypted`. That is a **login against a third-party
production system on a customer's account**, and an account-lockout risk is live across
this mission (track E step 0; brief I states the same rule: *"never attempt a RapidRMS
login"*). It also needs `AROS_ENCRYPTION_KEY`, which this workspace does not hold.

Codex's deliverable for step 0 is the **script plus the expected output**, handed to the
founder. Write it to `scripts/probe-lineitems.ts` (not wired into anything, not exported)
using the verified in-repo pattern from `connectors/data-service.ts:682-707`
(`withRapidRmsSession`: `setTenantSecret` → two `storeCredential` refs →
`rapidRms.authenticate` → `finally` delete both refs) — do not invent a second
credential path:

```ts
// scripts/probe-lineitems.ts — FOUNDER/OPERATOR ONLY. Read-only. Never run by an agent.
// Usage (founder, with AROS_ENCRYPTION_KEY + SUPABASE_* in the environment):
//   npx tsx scripts/probe-lineitems.ts <tenant-uuid> <YYYY-MM-DD>
import { createHash } from 'crypto';
import { createSupabaseAdmin } from '../src/supabase.js';
import { decryptValue, setEncryptionKey } from '../security/input-handler.js';
import { setTenantSecret, storeCredential, deleteCredential } from '../connectors/vault-ref.js';
import * as rapidRms from '../connectors/rapidrms-api.js';
import { invoiceDayBounds } from '../connectors/data-service.js';

const [tenantId, day] = process.argv.slice(2);
const secret = process.env.AROS_ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!tenantId || !day || !secret) throw new Error('usage: tenant-uuid YYYY-MM-DD, with AROS_ENCRYPTION_KEY set');
setEncryptionKey(createHash('sha256').update(secret).digest());          // = ensureConnectorCrypto(), src/server.ts:3682

const sb = createSupabaseAdmin();
const { data: rows } = await sb.from('tenant_connectors')
  .select('id, type, name, config, credentials_encrypted')
  .eq('tenant_id', tenantId).eq('type', 'rapidrms-api').eq('status', 'connected').limit(1);
const row = rows?.[0];
if (!row) throw new Error('no connected rapidrms-api connector for that tenant');

const secrets = JSON.parse(decryptValue(row.credentials_encrypted)) as Record<string, string>;
const vaultSecret = `${tenantId}:${process.env.AROS_ENCRYPTION_KEY || 'aros-dev'}`;   // vaultSecretFor(), src/server.ts:3692
setTenantSecret(vaultSecret);
const emailRef = await storeCredential(`${row.id}:probe-email`, secrets.email ?? '', vaultSecret);
const passwordRef = await storeCredential(`${row.id}:probe-password`, secrets.password ?? '', vaultSecret);
const session = await rapidRms.authenticate(                              // ← the login. One attempt only.
  { baseUrl: String(row.config.baseUrl || 'https://rapidrmsapi.azurewebsites.net'),
    clientId: String(row.config.clientId || ''), sessionTimeout: Number(row.config.sessionTimeout) || 420 },
  emailRef, passwordRef);

try {
  const bounds = invoiceDayBounds(day, day);
  for (const [name, call] of [['getSalesDetail', () => rapidRms.getSalesDetail(session, bounds)],
                              ['getInvoiceReport', () => rapidRms.getInvoiceReport(session, bounds)]] as const) {
    const t0 = Date.now();
    try {
      const out: any = await call();
      const first = (Array.isArray(out) ? out[0] : out?.data?.[0] ?? out?.rows?.[0]) ?? null;
      // KEY NAMES ONLY — never print a row. /api/InvoiceReport payloads sit next to
      // payment fields; a pasted row in an evidence file is the C1/PCI defect this
      // brief forbids everywhere else.
      console.log(name, Date.now() - t0, 'ms, keys:', first ? Object.keys(first) : '(no rows)');
    } catch (e) { console.log(name, Date.now() - t0, 'ms, ERROR:', String(e)); }
  }
} finally {
  // MANDATORY, and the reason this is a try/finally: withRapidRmsSession
  // (connectors/data-service.ts:682-707) always deletes its refs in a `finally`.
  // A probe that skips this leaves live POS credentials sitting in the vault-ref
  // store after the script exits.
  await Promise.all([emailRef, passwordRef].map((ref) => deleteCredential(ref).catch(() => {})));
}
```

**One run. If the login fails, STOP — do not retry** (a retry loop is how an account gets
locked, and this is a customer's POS account, not ours). Then time a 90-day
`getInvoiceReport` at `pageSize=5000` in a second, separate run.

**Pass / fail, decided on the printed key list — nothing else:**

| Probe result | Verdict |
|---|---|
| Either call's `row[0]` key list contains one of `Items \| items \| LineItems \| lineItems \| InvoiceItems \| invoiceItems \| details \| Details` | **PASS.** `flattenSalesRows` (`connectors/data-service.ts:542`) will produce line rows; Decision 1(b) stands; Steps 3.2 onward unblock. |
| `getSalesDetail` 404s **and** `getInvoiceReport`'s `row[0]` has none of those keys | **FAIL → Q2.** Header-only invoices mean no receipts, no basket pairs, no per-item series. STOP. |
| `(no rows)` for both on that date | **INCONCLUSIVE.** Re-run once on a date with known traffic; if still empty, treat as FAIL → Q2. |
| Either call ERRORs on auth | **STOP.** One attempt only — do not retry. |

The 90-day timing is **informational, not a gate**: it sizes the backfill chunk in
Step 7, and Decision 1(b) already rejects a live per-request pull regardless of
the number. Record it; do not block on it.

The founder pastes the stdout back; **Codex** writes the raw findings up in
`docs/missions/evidence/retail-profiles/phase2-lineitem-probe.md`.

**BLOCKING QUESTION for the founder (Step 0 cannot start without it):** who runs this
probe, and against which tenant? *Recommendation:* the founder runs it once against
their own connected store, not a customer's, and only after track E's step 0 has cleared
the current auth incident — a probe that trips a POS lockout on a paying tenant costs far
more than the day it saves. If the founder would rather not run it at all, say so and
Step 0's alternative is to derive the answer from already-synced data
(`store_snapshots` / the Cortex mirror) and mark Decision 1 UNVERIFIED, rather than
authorising an agent to log in.

The FAIL branch — including why a Cortex fallback is not yours to choose — is
**Q2**. The mid-flight quality tripwires and the four hard stops are **Q6** and **Q7** in
[Stop conditions — open decisions](#stop-conditions--open-decisions-come-back-to-the-founder). They are
not repeated here.

### Step 1 — GATE: confirm the journey spec is approved

`docs/journeys/should-i-reorder-this.md` is `STATUS: DRAFT — founder approval
required before any schema`. Confirm with the orchestrator that it is approved,
then land it on the working branch (copy from `origin/docs/retail-profiles`) so
the PR carries its journey spec, per `CLAUDE.md`'s journey gate.

### Step 2 — Pure core (no I/O, no imports outside `src/items/`)

Create `types.ts` first; **2–6 are independently reviewable and can be written in
parallel** once it exists:
1. `src/items/types.ts` — the types and `PACE_RULES`/`HORIZON_DAYS` above.
2. `src/items/keys.ts` — `sourceItemKey`, `isCleanBarcode`, `itemMatchKeys`, `isProfilableItem`.
3. `src/items/rollup.ts` — `collectItemDailyRollup`, `collectBasketPairs`.
   Both return `{ available, note }` when the input has no recognizable item
   code + qty, exactly like `connectors/data-service.ts:638-642`. Both must
   report `totalLines` / `unresolvedLines`.
4. `src/items/pace.ts` — `suggestPace`, `classifyHealth`.
5. `src/items/stock.ts` — `computeStockGuidance`, `validateOverride`, `daysOfCover`.
6. `src/items/profile.ts` — `assembleItemProfile`, composing 2–5. Zero `await`.

Reviewer check: `grep -n "supabase\|fetch(\|await " src/items/{types,keys,rollup,pace,stock,profile}.ts`
returns nothing.

Typecheck it with **`npx tsc -p tsconfig.json --noEmit`**, not `pnpm typecheck`.
Verified: `turbo typecheck` runs only in the three packages that define the
script (`apps/mcp-aros`, `apps/web`, `packages/pos-sdk`), so root `src/**` is
covered only by the root `tsconfig.json`. `pnpm typecheck` *is* the right gate
for the Step 9 web edits. **`pnpm lint` is a vacuous pass** — `lint` is declared
at `turbo.json:13` but no package in the workspace defines the script, so it
executes nothing and exits 0; never cite it as evidence.

### Step 3 — Migrations (three files, in this order)

0. `supabase/migrations/20260724_canonical_strong_key_rls.sql` — the **shared
   security fix**, exactly as in §Shared migration. **This track owns that DDL.**
   It is **not** gated on the journey-spec approval that gates 1 and 2: it closes
   a live defect on a merged table and may be reviewed and merged on its own,
   ahead of everything else in this package. First
   `git fetch origin && ls supabase/migrations | grep canonical_strong_key` — if
   the Customer Profile track has already landed it, verify the text matches
   §Shared migration and **do not add a second file**; if it differs, **STOP**
   and reconcile. Merge gate:
   `grep -rln "ALTER TABLE public.canonical_strong_key ENABLE ROW LEVEL SECURITY" supabase/migrations/ | wc -l`
   must print `1`.
   **This file must be applied before Step 5.1 runs against any real tenant** —
   Step 5.1 is what writes `upc`/`sku` strong keys into that table.
1. `supabase/migrations/20260724_entity_note.sql` — the **shared** note table,
   exactly as in §Shared migration. **This track owns that DDL.** Before writing
   it, `git fetch origin && git log --oneline origin/main -- supabase/migrations`
   and check whether the Customer Profile track has already landed a file
   creating `public.entity_note`. If it has and the DDL differs from §Shared
   migration, **STOP** — do not add a second `CREATE TABLE IF NOT EXISTS`
   (it is a silent no-op followed by runtime insert failures); reconcile with
   that track first.
2. `supabase/migrations/20260724_item_profile.sql` — this track's own tables,
   exactly as sketched in §Data contract. It must contain **no** `entity_note`
   DDL.

Then `node scripts/check-migration-safety.mjs` must exit 0 (the migration count
in its success line goes up by three, plus whatever other tracks have landed —
assert "increases", not an exact number). Runs in parallel with Step 2.

### Step 4 — Fetch shell (one append-only function in a shared file)

Append to the **end** of `connectors/data-service.ts` (it is shared; keep the
diff append-only so it merges cleanly):

```ts
export type ItemSalesDay = { sourceItemKey: string; businessDate: string; units: number; netSales: number; costTotal: number; receipts: number };

/** Item-LEVEL companion to fetchStoreSalesRange (:826). Uses flattenSalesRows so
 *  invoice_no survives onto each line (INVOICE_FIELDS, :103) — receipts and basket
 *  pairs both come from that. Returns available:false rather than guessing when the
 *  payload carries no per-line items (mirrors collectItemChanges, :638-642). */
export async function fetchStoreItemSalesRange(
  record: ConnectorRecord, vaultSecret: string, from: string, to: string,
): Promise<{ days: ItemSalesDay[]; lines: Array<Record<string, unknown>>; available: boolean; note?: string }>;
```
It reuses the module-private `withRapidRmsSession` (`:682-707`), tries
`getSalesDetail` then falls back to `getInvoiceReport` (same order as
`fetchTopSoldItems`, `:722-724`), runs `flattenSalesRows`, and delegates **all**
aggregation to `collectItemDailyRollup` from `src/items/rollup.ts`.
**Do not modify `fetchStoreSalesRange`.**

### Step 5 — Imperative shell + routes (new module, tiny server.ts diff)

1. `src/items/service.ts` — Supabase reads/writes via `createSupabaseAdmin()`,
   plus the golden binding: for each profilable catalog row call
   `resolveCanonical(createGoldenStore(), { tenantId, entityType: 'product',
   sourceSystem: 'rapidrms', sourceId: sourceItemKey, matchKeys: itemMatchKeys(...),
   displayName })` and write the returned `canonicalId` onto
   `item_catalog_snapshot.canonical_id` and `item_daily_sales.canonical_id`.
   **No second identity path. Never write `canonical_entity` directly.**
   **PRECONDITION — `resolveCanonical` writes into `public.canonical_strong_key`
   (via `claim_strong_key`), so `20260724_canonical_strong_key_rls.sql` MUST be
   applied to the target database before this runs against a real tenant.** This
   is the step that makes the ungated-table defect real rather than theoretical:
   one strong-key row per catalog row. If that migration is not applied, **STOP**
   (Q4).
2. `src/items/routes.ts` — one exported dispatcher
   `export async function handleItems(req, res): Promise<void>` implementing the
   whole HTTP contract, with the `401 → 409 → 403 → auditLog` ladder copied from
   `src/server.ts:6096-6099` / `:6115` / `:6128`.
3. `src/server.ts` — **exactly three edits, nothing else**:
   - one import line next to `src/server.ts:736`;
   - `const ITEMS_APP_KEY = 'items';` immediately after `src/server.ts:2632`;
   - the route hook immediately before the Documents block at `src/server.ts:7025-7028`:
     ```ts
     if (pathname === '/api/items' || pathname.startsWith('/api/items/')) {
       return handleItems(req, res);
     }
     ```

### Step 6 — Activation wiring (C6)

1. `src/server.ts:2801` — replace the hard-coded documents branch with a generic
   manifest application, keeping the documents call:
   ```ts
   if (appKey === DOCUMENTS_APP_KEY) await provisionDocumentsAccess(supabase, auth.tenantId);
   const { data: manifest } = await supabase.from('provisioning_manifests')
     .select('key').eq('source_kind', 'app').eq('source_key', appKey).eq('active', true).maybeSingle();
   if (manifest) await supabase.rpc('apply_provisioning_manifest', {
     p_tenant_id: auth.tenantId, p_source_kind: 'app', p_source_id: appKey,
     p_manifest_key: manifest.key, p_activate: true, p_actor: auth.userId });
   ```
2. `src/server.ts:2820` `handleMarketplaceDisable` — the mirror call with
   `p_activate: false`, placed before the existing `tenant_resources` update.
3. `src/server.ts:5575` `APP_CAPABILITY_BUNDLES` — add
   `items: { tools: ['aros_get_item_profile', 'aros_search_items'], skills: [{ name: 'Item Profile', capabilities: ['items.read'] }], agents: [] },`.
   This is name-advertisement only; the executors live in shreai.

### Step 7 — Backfill hook

The ingest is **per chunk**, not per day. In `runStoreSync`, the
`for (const day of daily)` loop closes at `src/server.ts:5689`, and the chunk
bookkeeping (`const chunkDays = ...`) starts at `:5690`. Insert the call
**between them** — after the whole chunk's `store_snapshots` upserts have
succeeded, before the cursor advances:
```ts
await ingestItemSalesChunk(supabase, job.tenant_id, row, cursor, chunkTo).catch((e) =>
  console.error('[store-sync.items]', jobId, e instanceof Error ? e.message : e));
```
`ingestItemSalesChunk` lives in `src/items/service.ts` and calls
`fetchStoreItemSalesRange`. **It must never throw into the sales path** — a
failing item rollup must not fail the revenue snapshot the dashboard depends on.

Also add a catalog refresh (`getInventory` → `GET /api/Item` →
`item_catalog_snapshot` upsert) at the start of `runStoreSync`.

### Step 8 — MCP surface (same PR as the routes, per the file's honesty rule)

`apps/mcp-aros/src/tools.ts`:
- append two entries to `operatorTools` (after `:82`):
  `aros_search_items` (`{ storeIds, query, limit }`, `readOnlyHint: true`) and
  `aros_get_item_profile` (`{ storeIds, itemKey, window }`, `readOnlyHint: true`),
  both with `securitySchemes: operatorOAuthSecurity('aros.items.read')`.
  Descriptions must state the honest limits: *"Reports units sold, sale
  frequency, receipts, items commonly bought together, and min/max carry
  guidance for a single item. Repeat-buyer identity is not available from
  connected data sources and is reported as unsupported."*
- extend `operatorToolRoute` (`:153`) with two branches returning
  `/api/items?...` and `/api/items/${encodeURIComponent(String(args.itemKey))}?window=...`.
- add both to `OPERATOR_TOOL_SCOPES` (`:206`) with `'aros.items.read'`.
- add two `demoResult` branches (`:225`) tagged `source: 'synthetic_demo'` like
  the existing ones.

Can run in parallel with Step 9.

### Step 9 — Web surface

Parallel with Step 8. Six files:
1. `apps/web/src/redesign/shellData.ts` — add `'items'` to `SectionKey` (`:7-11`);
   add `items: { key:'items', label:'Items', glyph:'It' }` to `EMBEDDED_APP_NAV`
   (`:37`), widening its `Record<...>` key union; add
   `items: 'Items'` to `SECTION_TITLES` (`:281`); add the **safe** `SECTIONS`
   entry (`:117`) — `items: { eyebrow: 'Items', lead: 'Look up any item…', rows: [] }`
   with **no `stats` and no `rows`**. Copying the `edi-invoices` shape at `:118-126`
   is a C4 defect by construction — do not.
2. `apps/web/src/redesign/routes.ts` — `'/items': 'items'` in `PATH_TO_SECTION`
   (`:8`) and `items: '/items'` in `SECTION_TO_PATH` (`:24`).
3. `apps/web/src/app/App.tsx` — `'/items'` into `KNOWN_PREFIXES` (`:40`) and
   `['/items', 'Items — AROS']` into `ROUTE_TITLES` (`:43-52`). Both are
   required: a path missing from `KNOWN_PREFIXES` 404s for signed-out visitors
   (`App.tsx:170`).
4. `apps/web/src/redesign/AppShell.tsx:181` — extend the gate condition to
   `section === 'documents' || section === 'edi-invoices' || section === 'items'`
   and add `if (section === 'items') return <ItemsPage />;` immediately after the
   `installedApps.has(section)` check (i.e. **before** the
   `demo ? <SectionPanel …> : <EdiInvoices />` line at `:190`), so `/items`
   renders the real page on both the demo and the authenticated shell.
5. `apps/web/src/redesign/pages/Items.tsx` + `pages/itemsApi.ts` (new) —
   modelled on `pages/EdiInvoices.tsx` / `pages/documentsApi.ts`. **No `demo`
   prop and no demo-only branch**: the page always calls `/api/items*` and
   renders whatever comes back. On `/preview/app` there is no session, so the
   call returns `401`/`409` and the page shows its honest signed-out /
   not-installed state — that *is* the demo behaviour, and it is what keeps
   invented item numbers structurally impossible. (Contrast `edi-invoices`,
   which in demo renders the fake `SECTIONS` rows at `shellData.ts:118-126` —
   the C4 trap this track must not copy.) Note `AppShell.tsx:97` seeds
   `installedApps` from **all** `EMBEDDED_APP_NAV` keys in demo, so once `items`
   is added there the `<AppInstallPrompt>` branch is unreachable at
   `/preview/app`; the not-installed state a local E2E can drive is the page's
   own `409` rendering.
6. `apps/web/src/app/items.css` (new) — mobile-first, `overflow-x: auto` on the
   90-day chart and any table, **zero horizontal page scroll 320–1440px**.

Every failure state in the journey spec's table must have a rendered branch:
catalog-not-synced (+ **Get my items now** → `POST /api/store/sync`), no search
match, barcode not in catalog, camera denied, never-sold, on-hand-unknown,
<14-days-history, per-invoice-lines-unavailable, EDI-not-activated,
min-above-max inline, override-save-failed with values retained, and
`as of HH:MM` + **Check now** on every screen.

### Step 10 — Evidence + docs

- `docs/missions/evidence/retail-profiles/` — the Step 0 probe, test output, and
  the horizon-toggle proof (before/after numbers for one item).
- The PR description must state, explicitly and in the founder's words: (a)
  cost_ledger / "deal" is cut from v1 and why; (b) repeat-buyers is deferred to
  Phase 3 and why; (c) the resolution rate the tenant's data actually achieves.

---

## Acceptance tests

### A. Pure-function unit tests — `src/__tests__/item-profile.test.ts`

Picked up automatically by `vitest.config.ts`. Model:
`src/__tests__/store-risk-exception-data.test.ts`.

```
npx vitest run src/__tests__/item-profile.test.ts
```

Required cases (each must fail before the code exists):

1. **Fast mover, real fixture.** `4429` "FIRE BALL CINNEMON WISKY 50ML" — 4,323
   units across 100 distinct sale days in a 100-day window.
   `suggestPace` → `'daily'`. `classifyHealth('daily', 0)` → `'selling_fine'`.
   `computeStockGuidance({horizon:'2w', posMaxStock: null})` → `minUnits === 217`,
   `maxUnits === 606` exactly (43.23/day; `up(43.23*5)`, `up(43.23*14)` under the
   6-decimal rounding rule in §Data contract). Assert the integers, not a range.
2. **Slow mover, real fixture.** `13918` — 15 units on 1 sale day in a 99-day
   window. `computeStockGuidance` → `{ available:false, reason:'not_enough_history' }`.
   `suggestPace` → `null`. **No number is emitted.**
3. **Twice-a-year, SYNTHETIC fixture** (the founder's required pair; 99 days of
   real history cannot contain one). 2 sale days, 1 unit each, 210 days apart, a
   365-day window. `suggestPace` → `'seasonal'`.
   `classifyHealth('seasonal', 40)` → `'selling_fine'` — **assert explicitly that
   it is NOT `'stalled'`**; this is the founder's core requirement.
   `computeStockGuidance({pace:'seasonal', horizon:'1y'})` → `minUnits === 1`,
   `maxUnits === 2`. Both fixtures produce sensible guidance under the same control.
4. **Never sold.** Empty `days[]` → `{ available:false, reason:'never_sold' }`
   from both `computeStockGuidance` and `classifyHealth`. Assert the response
   contains no `N/A`, no `0` velocity, and no `minUnits` key.
5. **Cap bites.** `posMaxStock = 120`, computed `maxUnits = 240` →
   `maxUnits === 120 && capped === true && capReason` is a non-empty sentence.
6. **Owner override wins.** `override = { minUnits: 25, maxUnits: 90, setAt }` →
   `source === 'owner'`, `minUnits === 25`, `maxUnits === 90`, and `basis`
   references the set date rather than the math.
7. **`validateOverride(90, 25)`** → `{ ok:false, field:'maxUnits', message: /smaller/ }`.
8. **Horizon monotonicity.** On **fixture 1** (`4429`, `pace:'daily'`,
   `posMaxStock: null`): `maxUnits` is `606` / `7868` / `15779` for `2w` / `6m` /
   `1y`, strictly increasing. Assert on an uncapped fast mover only — on the
   synthetic slow fixture the `max(minUnits+1, …)` floor makes 2w and 6m both
   `2`, so a strict `<` there would fail by design.
9. **`itemMatchKeys` never emits two keys.** Clean barcode → `{ upc }` only;
   junk barcode `'WN'` → `{ sku: 'client-2:3' }` only; non-unique barcode →
   `{ sku }` only. **Then feed both stores' outputs through `resolveCanonical`
   with an in-memory `GoldenStore` fake and assert `outcome !== 'created_flagged'`
   for the shared-barcode case** — this is the merge_candidate-flood regression test.
10. **`isProfilableItem`** rejects the open-ring row
    `{ itemCode:'3', barcode:'WN', name:'Wine', inCatalog:false }`.
11. **`collectItemDailyRollup` honesty.** Given header-only invoice rows (no item
    code, no qty) → `{ available:false, note }` with `rows.length === 0`.
    Given mixed rows → `unresolvedLines` is the exact count of lines with no
    catalog match, and `available === true`.
12. **`collectBasketPairs`** — three lines sharing one `invoice_no` produce three
    ordered pairs with `coReceipts === 1`; a line alone on its invoice produces none.
13. **Empty tenant.** All functions on empty input return the withheld shapes,
    never `NaN`, never `Infinity` (the `client-181155` 10-row tenant case).

### B. Routing unit test — `apps/web/src/redesign/routes.test.ts`

Already in `vitest.config.ts`'s `include`. Add:
`expect(routeState('/items')).toEqual({ mode: 'app', section: 'items' })` and
`expect(SECTION_TO_PATH.items).toBe('/items')`.
```
npx vitest run apps/web/src/redesign/routes.test.ts
```

### C. MCP surface test — `src/__tests__/mcp-aros-tools.test.ts`

```
npx vitest run src/__tests__/mcp-aros-tools.test.ts
```
Assert: both new tools appear in `operatorTools` and **not** in `customerTools`;
`operatorToolRoute('aros_get_item_profile', { itemKey: 'client-2:4429' })`
returns a non-null path starting `/api/items/`;
`missingOperatorScope('aros_get_item_profile', ['aros.store.read'])` returns
`'aros.items.read'`; and **the honesty invariant** — every name in
`operatorTools` has a non-null `operatorToolRoute(...)`.

### D. Migration safety

```
node scripts/check-migration-safety.mjs
```
Must exit 0. It fails the build for any `CREATE TABLE public.<t>` without
`ENABLE ROW LEVEL SECURITY` (`scripts/check-migration-safety.mjs:31-41`). Note
it **concatenates** every migration, so it cannot see a duplicate `CREATE TABLE
IF NOT EXISTS` for a shared table. Add this second check by hand, and to the PR
description:

```
grep -rln "CREATE TABLE IF NOT EXISTS public.entity_note" supabase/migrations/ | wc -l
grep -rln "ALTER TABLE public.canonical_strong_key ENABLE ROW LEVEL SECURITY" supabase/migrations/ | wc -l
```
Each must print `1` **once its file has landed** — the `canonical_strong_key`
one from Step 3.0 (unblocked today), the `entity_note` one from Step 3.1 (gated
on Q3). `0` before its step is expected; `2` at any time is the failure.
More than one file declaring `entity_note` = the second one
is a silent no-op; more than one file declaring the `canonical_strong_key` gate =
two owners for one security fix — **stop and reconcile with the Customer Profile
track** in either case. Verified why the lint cannot do this for you:
`scripts/check-migration-safety.mjs:24-25` reads every `*.sql` and `.join('\n')`s
them into **one** string before matching, so duplicate declarations are invisible
to it.

**Also assert the `REVOKE` survived** (the lint's REVOKE rule covers *views*
only, `:49-58` — it will not notice a missing table REVOKE):

```
grep -c "REVOKE ALL ON public.canonical_strong_key FROM anon, authenticated" supabase/migrations/20260724_canonical_strong_key_rls.sql
```
Must print `1`.

### E. RLS negative tests — cross-tenant read returns zero rows

There is **no RLS-test precedent in this repo** — you are creating it. Add
`scripts/rls-item-profile-check.mjs`, run against a **non-production** Supabase,
never prod.

**Standing up the database (there is no `supabase/config.toml` in this repo —
`supabase/` holds only `catchup/` and `migrations/`):**
```
npx supabase init          # creates supabase/config.toml — do NOT commit it in this PR
npx supabase start         # local stack; prints SUPABASE_URL / anon / service_role keys
npx supabase db reset      # applies every file in supabase/migrations in lexical order
node scripts/rls-item-profile-check.mjs
```
A bare `postgres:16` container will **not** work: the policies call `auth.uid()`
and `entity_note.created_by` FKs `auth.users(id)`, both of which only exist in
the Supabase stack. If neither a local stack nor a dev project is available,
**STOP and report** — do not mark this test skipped.
It must, using the **anon** key plus a signed user JWT (never the service-role
key, which bypasses RLS):
1. seed two tenants A and B and one member each, via the service role;
2. insert one `item_daily_sales`, one `item_catalog_snapshot`, one `item_pace`,
   one `item_stock_override`, one `item_basket_pair`, one `entity_note` row for
   each tenant, via the service role. The `entity_note` row uses this track's
   shape — `(tenant_id, entity_type: 'product', entity_key: sourceItemKey,
   canonical_id: null, body, created_by)` — which also proves the note write is
   valid against the **shared** DDL this track owns but does not exclusively
   use. Then assert a second `'product'` note for the same `entity_key` is
   rejected by `uq_entity_note_product`, while an `entity_type: 'customer'` row
   with the same `entity_key` inserts fine (the Customer Profile track keeps
   many notes per card);
3. as tenant A's member, `select` each of the six tables and assert **exactly**
   the A rows come back and **zero** B rows;
4. as tenant A's member, attempt an `insert` and an `update` on each of the six
   and assert every one is **rejected** (writes are service-role-only by design);
5. **`canonical_strong_key` — a NEGATIVE privilege assertion, not a zero-row
   one.** Seed one strong-key row per tenant via the service role, then, as
   tenant A's member, `select` from `public.canonical_strong_key` and assert the
   call **fails** with `42501 insufficient_privilege` (PostgREST surfaces it as
   `401`/`403` with `code: '42501'`). **Zero rows returned is a FAIL**, not a
   pass: it would mean the `REVOKE ALL` in
   `20260724_canonical_strong_key_rls.sql` had been lost and only the policy was
   filtering. Assert it for the caller's **own** tenant too, where the policy
   would otherwise have allowed the read;
6. exit non-zero on any violation.

### F. Route-level integration

```
npx vitest run src/__tests__/item-profile-routes.test.ts
```
With `authenticateRequest` and `hasActiveAppEntitlement` stubbed:
- no session → `401`;
- session, no `items` entitlement → `409` and the body message names the
  Marketplace;
- session + entitlement, `role: 'member'`, `PUT /api/items/x/stock` → `403`;
- session + entitlement, `role: 'owner'`, `PUT` with `minUnits > maxUnits` → `400`
  with `{ field: 'maxUnits' }`;
- `GET /api/items/:key` response contains all three horizons under `guidance`
  (the <100ms no-round-trip contract).

### G. Browser E2E — `e2e/should-i-reorder-this.spec.ts`

```
npx playwright test e2e/should-i-reorder-this.spec.ts
```
Local mode (mocked `/api/*`, no backend — see `playwright.config.ts:22-26`),
modelled on `e2e/install-app-from-marketplace.spec.ts`:
1. `/preview/app` → **Items** is reachable from the nav and lands on `/items`.
   (Demo seeds `installedApps` from every `EMBEDDED_APP_NAV` key,
   `AppShell.tsx:97`, so the nav entry is present without any mock.)
2. With `/api/items*` mocked to a `409` carrying the install message, **the page**
   renders that message with a link to Marketplace, and no numbers appear
   anywhere on screen. **Do not assert `<AppInstallPrompt>` here** — that branch
   (`AppShell.tsx:187`) is unreachable at `/preview/app` because demo treats
   every embedded app as installed. `<AppInstallPrompt>` is proven on beta
   instead, in test H's deactivate step.
3. With the full profile payload mocked, the golden-path sentence renders, then
   **clicking `6 months` changes both numbers with zero further network
   requests** — assert by counting `page.route` hits before and after. This is
   the journey spec's stated proof that the control is real.
4. With the `never_sold` payload mocked, assert the honest sentence renders and
   assert `await page.getByText('N/A').count() === 0`.
5. **Zero horizontal scroll at 320 / 768 / 1440px:** at each viewport assert
   `document.documentElement.scrollWidth <= document.documentElement.clientWidth`.

### H. Live/deployed proof — **[FOUNDER/OPERATOR-EXECUTED]**

Codex does not run this: it requires a deploy to beta and an app activation on a
real tenant, both outside any executor's authority (Q7d). Codex's deliverable is
the spec, the commands and this checklist, handed over.

Real flow, on beta, as the persona, with founder approval for the activation:
```
node scripts/journey-walk.mjs --base <beta-url>
E2E_BASE_URL=<beta-url> npx playwright test e2e/should-i-reorder-this.spec.ts
```
Then, by hand and with timings recorded into
`docs/missions/evidence/retail-profiles/`:
install **Items** from `/marketplace` → `/items` first paint **<1.0s** → type
three letters, list filters **<200ms** → open item `4429`, P95 **<1.5s** on a 4G
profile → toggle the horizon, re-render **<100ms** with no network request →
open item `13918` and confirm the recommendation is **withheld with a sentence**,
not a zero. Finally deactivate the app and confirm `/items` returns to the
install prompt and the API returns `409`.

---

## Non-goals

This track must **not** touch:

- **`skills/`** — do not import from it, do not add it to `pnpm-workspace.yaml`,
  do not delete it, do not modify `deal-hunter.ts`. Named formulas are
  reimplemented in `src/items/` with attribution comments (§Verified ground truth).
- **`connectors/rapidrms/analytics-connector.ts`** — stale matview list, SQL
  interpolation, workstation-path credentials, zero production importers.
- **`rapidrms.cost_ledger` and any "deal terms" surface.** The word "deal" does
  not appear in Item Profile.
- **Repeat-buyer counts.** Phase 2 ships `sold on N receipts` (distinct
  `invoice_no`, verifiable) and an honest absence for repeat buyers. Counting
  repeated invoice numbers and calling them buyers is a C4 defect. Deferred to
  Phase 3, where a real customer identity exists.
- **Any customer identity, PAN, cardholder name, `cashier_name`, or `register_id`.**
  None of these enter `src/items/` or the new tables.
- **`regulars_*` / `aros_customer_*` MCP tools** — that surface is public and
  `noauth` (`apps/mcp-aros/src/tools.ts:25,85`) and belongs to REGULARS (C3).
- **`shreai` (`shre-router`)** — no PR in that repo in this track. AROS only
  *advertises* the tool names (Step 6.3). The executor implementation in
  `shre-router/src/tools/aros-tools.ts` is a **named follow-on**, and it must
  first reconcile with the existing `aros_run_reorder` (`:38`) and
  `aros_run_dead_stock` (`:62`), which answer a similar question against legacy
  MIB007. Two reorder answers is the exact Lightspeed failure the journey spec
  forbids.
- **Writing min/max back to RapidRMS** — writes are blocked server-side; the
  precedent is draft-then-approve (`aros_draft_action`).
- **Purchase-order generation, multi-store comparison, price optimisation,
  vendor promo evaluation** — all explicitly out of scope in the journey spec.
- **`fetchStoreSalesRange` (`connectors/data-service.ts:826`) and
  `store_snapshots`** — the revenue path is working; add alongside, never rewrite.
- **`src/golden/*`** — bind to it, do not extend or alter it.
- **Deleting or "cleaning up" anything.** Additive only.

---

## Collision warnings

`src/server.ts` (7,214 lines) and `apps/web/src/redesign/` are the two hottest
paths in this repo. There are 15+ live aros worktrees; recent `main` commits
touch email templates, wallet (×3), automation rules 1a+1b, timecard
corrections, the EDI entitlement gate and marketplace hardening. Named in-flight
branches include `feat/chat-rich-input-aros`, `feat/email-templates`,
`feat/automation-rules-1b`, `feat/capability-hub-p2`, `fix/marketplace-auth-ui`.

| File | Risk | Sequencing |
|---|---|---|
| `src/server.ts` | **Highest.** Nearly every track edits it. | Keep the diff to the **four** edits in Steps 5–7 (import, `ITEMS_APP_KEY`, route hook, capability bundle) plus the two activation blocks. Land them **last**, in one commit, immediately before opening the PR. Rebase on `origin/main` right before pushing. If a conflict appears, re-apply by hand — never accept a merge that moves other handlers. |
| `src/server.ts:2763` `handleMarketplaceInstall` | `fix/marketplace-auth-ui` and marketplace-hardening work live here. | Step 6's generic manifest block is 6 lines appended after the existing documents line. If that function has moved, re-anchor on the literal `if (appKey === DOCUMENTS_APP_KEY)` string, not the line number. |
| `apps/web/src/redesign/shellData.ts` | Union types + nav arrays are edited by every app-adding track. | Add `'items'` at the **end** of each union/record. Expect a conflict; resolve by keeping both additions. |
| `apps/web/src/redesign/AppShell.tsx` | `feat/chat-rich-input-aros` is active here. | Touch only the gate condition at `:181` and add one `if (section === 'items')` line. Do not reformat `renderSection`. |
| `apps/web/src/app/App.tsx` | `KNOWN_PREFIXES`/`ROUTE_TITLES` are append-only lists. | Append; never reorder. |
| `connectors/data-service.ts` | Shared with connector/exception tracks. | **Append-only** at end of file. Do not touch `flattenSalesRows`, `fetchStoreSalesRange`, or any existing `collect*`. |
| `apps/mcp-aros/src/tools.ts` | Edited by MCP-convergence and RapidSupport MCP work. | Append to the end of `operatorTools`, add branches at the end of `operatorToolRoute` before its `return null`, append to `OPERATOR_TOOL_SCOPES`. |
| `supabase/migrations/` | Filename collisions on the same date. | If `20260724_item_profile.sql` exists, use `20260724_item_profile_phase2.sql`. Never edit an existing migration. **Exception: do not rename `20260724_entity_note.sql` or `20260724_canonical_strong_key_rls.sql`** — the Customer Profile track depends on those exact names and on them sorting first (`c` < `e` < `i` < `20260725`). |
| `public.canonical_strong_key` gate — **shared with `h-customer-profile-plugin`** | The table ships with **no RLS, no policy and no REVOKE** (`20260720_golden_records.sql:110` omits it). Both tracks write strong keys into it; this track's Step 5.1 writes one for **every catalog row**. Two tracks each carrying their own copy of the fix is the same one-declaration hazard as `entity_note`. | **This track owns the fix**, in its own file `20260724_canonical_strong_key_rls.sql` (§Shared migration), carrying `ENABLE ROW LEVEL SECURITY` + the member-select policy **and** `REVOKE ALL … FROM anon, authenticated`. Customer Profile's migration contains none of it. It sorts first and is **not** gated on this track's journey-spec approval. Before merging, `grep -rln "ALTER TABLE public.canonical_strong_key ENABLE ROW LEVEL SECURITY" supabase/migrations/ \| wc -l` must print **1** — `check:migrations` concatenates the migration set (`scripts/check-migration-safety.mjs:24-25`) and cannot see a duplicate. If the other track has already landed it and it differs, **STOP** and reconcile — do not add a second. |
| `public.entity_note` — **shared with `h-customer-profile-plugin`** | Both tracks write to one table. Two `CREATE TABLE IF NOT EXISTS` blocks would make the second migration a **silent no-op** and the second track's inserts fail at runtime, not at apply time. | **This track owns the DDL**, in its own file `20260724_entity_note.sql` (§Shared migration). Customer Profile's migration contains no `entity_note` DDL at all. Before merging, `grep -rln "CREATE TABLE IF NOT EXISTS public.entity_note" supabase/migrations/ \| wc -l` must print **1**. If the other track has already landed one and it differs, **STOP** and reconcile — do not add a second. |
| `src/golden/*` | Customer Profile adds `'card_fp'` to `STRONG_KEYS.customer` (`src/golden/resolve.ts:55-59`). | **This track does not touch `src/golden/` at all** (see §Non-goals) and works entirely within the existing `product: ['upc','gtin','sku']`. There is therefore **no mutual conflict** on that file, and nothing here to sequence. If a rebase surfaces a change under `src/golden/`, it is not yours — do not adopt it. |
| Cortex warehouse | A concurrent recon track was observed probing `rapidrms.invoice_report` during this session (it overwrote a scratchpad probe file). | Read-only probes only, and write probe output to a uniquely named file. |

**Worktree discipline (non-negotiable, `CLAUDE.md`):** do all work in
`~/.shre/worktrees/aros/item-profile` created via shre-dev-kit
`scripts/worktree.ps1`. **Never** run branch-switching or tree-mutating git
commands in `C:/Users/nirpa/Documents/Projects/aros` — concurrent sessions are
live on it. Read other refs with `git show origin/main:<path>`.

---

## Rollback

The design is additive and activation-gated, so rollback has three independent
levels — use the smallest one that fixes the problem.

**Level 1 — per tenant, no deploy (seconds).**
`POST /api/marketplace/apps/items/disable` (or the Marketplace UI). Per
`src/server.ts:2820`, this flips the entitlement to `disabled`, sets matching
`tenant_resources` to `inactive`, and (with Step 6.2) detaches the manifest
bindings. Immediately: every `/api/items/*` route returns `409`, the nav entry
disappears, `/items` shows `<AppInstallPrompt>`. No data is deleted. Re-install
restores everything.

**Level 2 — platform-wide, no deploy (one SQL statement).**
```sql
UPDATE public.platform_apps SET status = 'inactive' WHERE id = 'items';
UPDATE public.provisioning_manifests SET active = false WHERE key = 'app.items.v1';
```
Items vanishes from the Marketplace catalog (`src/server.ts:2983` orders over
`platform_apps`) and no new tenant can install it. Existing installs keep
working — pair with Level 1 if they must not.

**Level 3 — code revert.**
`git revert` the PR merge commit. The four `src/server.ts` edits, the
`apps/mcp-aros` additions and the six web files all revert cleanly because each
is additive. **Never revert `20260724_canonical_strong_key_rls.sql`** — it is a
security fix on a merged table, it is depended on by the Customer Profile track,
and reverting it leaves every strong key (this track's `upc`/`sku` and that
track's `card_fp`) in a table with no RLS and no REVOKE. It is not part of this
feature and does not come out with it. **Do not revert either of the other two
migrations** either — leave the tables in place; they
are additive, RLS-protected, hold no PII and no PAN, and are unreachable once
the app row is inactive. If they must go, a separate down-migration drops this
track's **five** tables and deletes the `platform_apps` /
`provisioning_manifests` rows. **`public.entity_note` is never dropped** — it is
shared with the Customer Profile track and may hold that track's rows;
`canonical_entity` rows minted by the resolver are **left alone** (they are
shared golden records and Phase 3 will use them).

**Backfill rollback.** The item ingest in Step 7 is wrapped in `.catch()` so it
can never fail the revenue snapshot. To undo an ingest for one tenant:
```sql
DELETE FROM public.item_daily_sales   WHERE tenant_id = '<uuid>';
DELETE FROM public.item_basket_pair   WHERE tenant_id = '<uuid>';
DELETE FROM public.item_catalog_snapshot WHERE tenant_id = '<uuid>';
```
Owner-authored rows (`item_pace`, `item_stock_override`, `entity_note`) are
**never** deleted by a rollback — his numbers always win, including across a
re-install.

**Rollback trigger conditions.** Roll back immediately if: any screen shows a
number whose source cannot be named; a cross-tenant row appears in any
`/api/items/*` response; `merge_candidate` grows by more than ~1% of resolved
items in a day (the strong-key rule has failed); or `runStoreSync` failure rate
rises after Step 7 lands.

---

## Stop conditions — open decisions, come back to the founder

This section is the single place every "STOP" in this brief resolves to. Nothing here
is repeated elsewhere; Step 0 points at Q1/Q2/Q6/Q7 and Step 3 points at Q4/Q5.

**Q1 — [BLOCKING, Step 0 cannot start] Who runs the line-item probe, and against which
tenant?** Step 0 needs a login against a **third-party production POS on a customer's
account**, with `AROS_ENCRYPTION_KEY`, which this workspace does not hold. The full
question, the recommendation (founder runs it once against their **own** connected store,
after track E's step 0 clears the current auth incident), and the no-probe fallback
(derive from `store_snapshots` / the Cortex mirror and mark Decision 1 UNVERIFIED) are
written out in Step 0. **One attempt only — if the login fails, stop; a retry loop is how
a paying tenant's POS account gets locked.**

**Q2 — [BLOCKING, gates the migration] Neither endpoint yields per-line item rows.**
Per Step 0 and UNVERIFIED #1: if `InvoiceReport` is header-only and `SalesDetail` 404s,
**the entire item rollup has no source over the HTTP path** — no receipts, no basket pairs,
no per-item series, roughly half the journey spec. **Do not fall back to Cortex on your own
initiative:** that is new infrastructure (new credentials, a tenant→`store_id` map) and the
only production precedent, `shreai: shre-router/src/tools/forge-basket-tools.ts:73`, has
**zero tenant isolation**. **Recommendation: stop and re-scope Phase 2 to what the header
rows can honestly support**, rather than ship a plausible-looking surface over an
unavailable source.

**Q3 — [BLOCKING, Step 1] The journey spec is still DRAFT.**
`docs/journeys/should-i-reorder-this.md` carries `STATUS: DRAFT — founder approval required
before any schema`. Confirm approval with the orchestrator before Step 3's migration. The
repo's journey gate (`CLAUDE.md`) requires the spec in the same PR as the E2E.

**Q4 — RESOLVED 2026-07-24 — no longer a founder question, but a hard merge gate and a
sequencing rule.** `canonical_strong_key` had no RLS, no policy and no REVOKE. Verified:
`supabase/migrations/20260720_golden_records.sql:110` enumerates
`['canonical_entity','entity_alias','merge_candidate','negative_pair','merge_event']`
— `canonical_strong_key` (created at `:29`) is in **none** of the RLS/GRANT/REVOKE loops.
This brief previously called that *"deliberately absent"*; **it is a live defect**, and
Step 5.1 would make this track the first to put production rows (`upc`/`sku`) into an
ungated golden table. The *"nothing grants it today"* argument does **not** hold: four
other migrations in this repo revoke Supabase's **default** privileges explicitly
(`20260716_oidc_rp_sessions.sql:17`, `20260717_experience_routing_identity_links.sql:16,34,45`,
`20260717_public_commerce.sql:96-98`, `20260717_terms_acceptances.sql:57`), which only
makes sense if the defaults do grant.
**Resolution:** the fix is `supabase/migrations/20260724_canonical_strong_key_rls.sql`,
**owned by this brief** (§Shared migration), carrying `ENABLE ROW LEVEL SECURITY` + the
member-select policy **and** `REVOKE ALL ON public.canonical_strong_key FROM anon,
authenticated;`. It is its own file, it sorts before `20260724_entity_note.sql`,
`20260724_item_profile.sql` and `20260725_customer_profile.sql`, `h-customer-profile-plugin`
depends on it and declares none of it, and it is explicitly carved out of this track's
journey-spec founder gate so a feature gate cannot hold a security fix.
**STOP if:** `grep -rln "ALTER TABLE public.canonical_strong_key ENABLE ROW LEVEL SECURITY" supabase/migrations/`
returns more than one file; **or** the landed file differs from §Shared migration; **or**
Step 5.1 is about to run against a real tenant and that file has not been applied; **or**
anyone proposes burying the fix inside a feature migration or editing
`20260720_golden_records.sql` in place. Do not treat a green `pnpm check:migrations` as
evidence — `scripts/check-migration-safety.mjs:37-38` matched the neighbouring DO-block
via a 4,000-character proximity regex, which is precisely why this defect shipped
(re-verified 2026-07-24 by running the lint's own three regexes over the concatenated
migration set: for `canonical_strong_key` the direct `ALTER TABLE public.<t> ENABLE ROW
LEVEL SECURITY` test is **false** and only the two proximity tests are true, and appending
a second identical declaration changes **nothing** in the result).

**One thing the founder must confirm, not the executor — [CONFIRM BEFORE OPENING THE PR]:
may `20260724_canonical_strong_key_rls.sql` be raised as a standalone PR while
`docs/journeys/should-i-reorder-this.md` is still `STATUS: DRAFT`?** This brief now says
yes and carves that one file out of the journey-spec gate. **Recommendation: yes.** The
gate exists so no *schema for a new capability* is invented ahead of an approved journey;
this file creates no table, adds no column, ships no user-visible surface and no journey —
it enables RLS and revokes default privileges on a table that is **already merged and
already writable**, closing a live defect. Holding a security fix behind a product gate
inverts the purpose of both. It is also the only ordering that works: the fix must precede
the first `resolveCanonical` write from **either** track, and the Customer Profile track is
partially unblocked while this one is not. **If the founder says no**, the fallback is that
whichever feature migration lands first carries the block inline — and then the
one-declaration merge gate above becomes mandatory rather than belt-and-braces, because two
tracks would each be carrying a copy. Do not choose the fallback silently.

**Q5 — [BLOCKING, shared table] `public.entity_note` is created by BOTH this track and
`h-customer-profile-plugin`, with different DDL, both `CREATE TABLE IF NOT EXISTS`.**
The second migration is therefore a **silent no-op** and the second track's writes fail at
runtime, not at migration time. **Do not merge either migration until one DDL is agreed and
pasted byte-identically into both briefs.** *Recommendation:* this track's polymorphic shape
(`entity_type` + `entity_key`, nullable `canonical_id`) is the superset — widen its CHECK to
`('product','customer')` and let H bind to it; or extract `entity_note` into its own
migration both tracks depend on. Either way, add a column-presence assertion to both tracks'
acceptance suites: a silent no-op is the wrong failure mode for a table two tracks share.

**Q6 — Quality tripwires that stop the track mid-flight** (each is a founder call, not a
threshold to tune):
- sale-line resolution rate below ~80% (recon measured 83.5%) ⇒ "units sold" is materially
  wrong and hiding that is a C4 defect;
- `resolveCanonical` returns `outcome: 'created_flagged'` for more than ~1% of items on a
  backfill ⇒ the strong-key rule has failed; the fix is a key decision;
- min/max cannot be made trustworthy for slow movers ⇒ ship history + frequency **without**
  a recommendation and tell the founder, per the contract's own kill criterion;
- the founder rejects deferring "repeat buyers" to Phase 3 ⇒ there is no wired customer
  identity to count, so the only alternatives are fabricating one or pulling Phase 3
  forward.

**Q7 — Hard stops, no discussion.** Any design pressure to (a) store, log, display or return
a PAN, cardholder name, `cashier_name` or `register_id`; (b) add a second
identity-resolution path instead of binding to `canonical_entity`; (c) add an allow-list
entry to `scripts/check-migration-safety.mjs` or edit an existing migration to make it pass;
or (d) activate the app against a live tenant, deploy, or restart anything. Each is an
immediate stop — (b) is an explicit kill criterion, (c) is how the RLS gate stops meaning
anything, and (d) is outside any executor's authority.
