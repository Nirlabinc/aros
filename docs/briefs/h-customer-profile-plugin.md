# Build brief — Customer Profile app (retail-profiles Phase 3)

**Slug:** `h-customer-profile-plugin`
**Repo of record:** `Nirlabinc/aros` (this repo). Read code from a worktree off
`origin/main`. **Never** run branch-switching or tree-mutating git commands in
`C:/Users/nirpa/Documents/Projects/aros` — a concurrent session is live on it.
**Executor:** Codex, assumed zero prior context on this codebase. Every claim
below carries a `path:line` anchor that was opened and read. Where something
could not be verified it says **UNVERIFIED** and names what would verify it.

---

## START HERE — what is blocked, and on whom

**Two things gate almost everything here.** (1) This track's journey spec,
`docs/journeys/see-who-comes-back.md`, is `STATUS: DRAFT — founder approval
required before any schema` — **so no migration of this track's own may be
written until it is approved (Q15).** (2) No number may reach a tenant until the
founder answers Q1, Q2, Q5, Q7 and Q9. Every "BLOCKED" row resolves in
[Stop conditions — open decisions](#stop-conditions--open-decisions-come-back-to-the-founder).

| Work | Status | Unblocked by |
|---|---|---|
| **Step 1** — pure core `src/customers/{normalize,keys,fingerprint,confidence,aggregate}.ts` | **START NOW.** No I/O, no schema, no user-visible surface, and composition-agnostic so either Q1 answer is a one-constant change. | — |
| **Step 2** — `20260724_canonical_strong_key_rls.sql` (copy-or-verify, owned by track G) | **START NOW.** It creates no table and ships no journey — a security fix on merged code, explicitly outside both tracks' journey gates. | — |
| **Acceptance T1, T2, T3** (pure) and **T9** (typecheck/build) | **START NOW.** T1–T3 test exactly Step 1. | — |
| **Step 2** — `20260725_customer_profile.sql` + `20260724_entity_note.sql` (copy-or-verify) | **BLOCKED.** These create schema for a new capability. | **Q15** (journey spec approved), then **Q9** (legal sign-off) to merge |
| **Step 4** — `PaymentSource` interface + `createFixturePaymentSource` | **START NOW.** The interface and the fixture source are unblocked. | — |
| **Step 4** — `createWarehousePaymentSource()` (the real read path) | **BLOCKED.** There is no server-side Cortex read path in this repo (ground truth F). | **Q3** |
| **Step 3** — `'card_fp'` into `STRONG_KEYS.customer` | **BLOCKED. The only edit to merged golden-record code in this whole package.** | **Q13** (and Q1 first — the founder is really ratifying the key's *composition*) |
| **Step 5** — ingest shell | Writeable against the fixture source; **must not run against a real tenant** before Q3 + Q9. | Q3, Q9 |
| **Steps 6–9** — handlers, readiness UI, shell wiring, page | **BLOCKED.** This is the user-facing capability the journey gate exists for, and the **numbers** it renders are separately gated. | **Q15** first; then Q8 (naming — **resolve before any UI copy**), Q1, Q2, Q5, Q7 |
| **Acceptance T4** (resolver binding) | **BLOCKED** with Step 3. | Q13 |
| **Acceptance T5** (PII/PCI leak) | **BLOCKED** with the handler projections it serialises (Step 6). | Q15 |
| **Acceptance T6 / T6b** (RLS + privilege) | Runnable once Step 2's migration lands; needs a scratch Supabase (see T6). | Q15 |
| **Acceptance T7** (kill-criterion re-check) | **FOUNDER/OPERATOR ONLY** — a live warehouse credential this workspace does not hold. | Founder |
| **Acceptance T8** | The 401 and 503 cases run today; the 409/403 cases need a token from the founder. | Founder (for the token only) |
| **Acceptance T10** (live golden path) | **FOUNDER/OPERATOR ONLY** — deployed beta + a real activation. | Founder |

**Q8 (naming) is the cheapest one to get wrong.** It decides `/customers`, the
`platform_apps.id`, the nav key and every string in Step 9. Ask it before Step 6,
not after.

---

## Track

Build an activatable, owner-facing **Customers** app inside the AROS shell that
answers one question for a single-store owner: *"am I getting people back, or is
it all one-time walk-ins?"* — computed from card payments already flowing into
the Cortex warehouse, keyed on a **per-tenant salted hash of card brand + last-4**
(never a PAN, never a stored cardholder name), resolved through the **existing**
golden-record layer (`resolveCanonical` + `createGoldenStore()`), and rendered
with an honest "as of" timestamp and an explicit "cash customers aren't in here"
caveat.

**User-visible outcome (the success signal):** the owner activates **Customers**
from the Marketplace Apps tab, a **Customers** entry appears in the workspace
nav, and opening it shows one sourced sentence — *"Last 90 days: 13,288 card
payments from about 4,851 different cards. 2,160 cards came back more than
once — that's 44%."* — over a list of `VISA ••••4412 · 9 visits · $214 spent ·
last seen Tuesday`, each row opening a real per-card detail with visits, spend,
first/last seen, top 5 items, and an owner note box. Every number traces to real
rows or the screen says it cannot know.

### C3 — Patent adjacency (must be read before writing any code)

> Customer Fabric / **REGULARS** is patent-pending (US Provisional 64/113,480)
> and owns consumer identity, consent tiers, loyalty, and the consumer surface
> at `regulars.aros.live`. This track is the **OWNER-SIDE analytic view of the
> owner's own transaction data** — pseudonymous, in-store, no consumer account,
> no consent tier, no cross-merchant portability. Anything drifting toward
> consumer identity, loyalty, or cross-store recognition belongs to REGULARS and
> **must be escalated to the founder, not built here.**

The REGULARS side already exists in this repo at `src/public/customer-api.ts:1`
("Regulars Phase 1 — customer-safe public commerce API", unauthenticated,
serving `/api/public/businesses/{slug}/*` for `apps/mcp-aros`). Owner-side code
must **not** share tables, routes, handler files, or naming with it.

The live data forces the boundary question immediately: **234 brand+last4
identities already appear at more than one `store_id`.** Counting them together
would be cross-store recognition. This brief therefore bakes the store scope
**into the hash input** so identities can never merge across stores — see
[Data contract](#data-contract).

### Kill criterion — carried forward verbatim, and its measurable test

> "Phase 0 finds no usable payment identifier → Phase 3 stops for a founder
> decision (do not substitute a guess)."
> — `docs/missions/retail-profiles.md`, §Kill criteria
> (branch `origin/docs/retail-profiles`; read with
> `git show origin/docs/retail-profiles:docs/missions/retail-profiles.md`)

"Usable" means **all four** of the following, each a measurable check against
live data. All four were evaluated read-only on 2026-07-23 and **all four PASS**,
so Phase 3 proceeds:

| # | Check | Threshold | Measured 2026-07-23 | Verdict |
|---|---|---|---|---|
| a | A card identifier is present on a material share of payment rows, from a source refreshed inside 24h | ≥ 25% of payment rows carry brand + last-4 | 13,288 of 20,511 rows = **64.8%**; `synced_at` max 2026-07-23 08:56Z | PASS |
| b | It is stable enough to show repeat behaviour | ≥ 15% of distinct identities seen on >1 invoice | 4,851 distinct identities, 2,160 repeat = **44.5%** over 2026-04-15..2026-07-23 | PASS |
| c | It is PCI-safe — no PAN reachable | zero stored values contain a run of ≥5 consecutive digits | zero. Shapes: `DDXXXXXXXXXXDDDD` ×11,891, `XXXXXXXXXXXXDDDD` ×125, bare 4 digits ×1,256, 3 non-digit chars ×5, empty ×7,218, 16 stragglers at length 13/15/18 | PASS |
| d | It joins to basket data (so "what they usually buy" is real) | ≥ 90% of card invoices join to line items | **13,264 of 13,264 = 100%** | PASS |

**Codex must re-run these four checks (queries in [Acceptance tests](#acceptance-tests),
step T7) before rendering a number for any tenant.** If any single one fails for
a tenant, that tenant gets the honest empty state — never a substituted guess.

---

## Verified ground truth

### A. The golden-record layer is merged, correct, and has zero production callers

`src/golden/resolve.ts:68` is `resolveCanonical(store, input)` — **the one
resolver**. Its decision order is: alias hit → auto-link → `created_flagged`
(ambiguity/conflict, never auto-merge) → `created_clean`.

`src/golden/resolve.ts:55-59` is the entire binding point for this track:

```ts
const STRONG_KEYS: Record<EntityType, string[]> = {
  product: ['upc', 'gtin', 'sku'],
  location: ['geohash', 'address_norm'],
  customer: ['phone_hash', 'email_hash'],
};
```

There is **no card key**. Adding `'card_fp'` to the `customer` array is the
*complete* resolver change required by decision D2 (one resolver, no fork).

`src/golden/resolve.ts:79-83` is the branch that silently mints a fresh identity
when no strong key is supplied — this is why the ingest **must** pass `card_fp`,
or every payment becomes a new "customer":

```ts
  if (strongEntries.length === 0) {
    const id = await store.createCanonical({ tenantId, entityType, displayName: input.displayName, matchKeys: input.matchKeys });
    await store.writeAlias({ tenantId, entityType, sourceSystem, sourceId, canonicalId: id });
    return { canonicalId: id, outcome: 'created_clean' };
  }
```

`src/golden/resolve.ts:51-53` states plainly that `negative_pair` suppression is
**not** wired at resolve time — it belongs to a merge/review flow that does not
exist. The journey's "No, different — remembered forever" step therefore has no
implementation today.

`src/golden/store.ts:11` `createGoldenStore()` is the real Supabase-backed
`GoldenStore` (service-role admin client). `src/golden/store.ts:77`
`flagCandidate()` inserts a `merge_candidate` row with `status: 'open'` — this is
the low-confidence sink D1 requires.

`supabase/migrations/20260721_golden_claim_fn.sql:10` defines
`public.claim_strong_key(p_tenant, p_entity_type, p_key_type, p_key_value, p_canonical)`
— atomic, race-safe, reassigns keys off `merged_away` owners. **Reusable as-is
for `card_fp`; no change needed.**

Existing callers of `resolveCanonical` / `createGoldenStore` in the whole repo:
`src/__tests__/golden-resolve.test.ts` and `src/__tests__/golden-store.test.ts`
only. Nothing in production calls them. The journey's framing of golden-record
ingest as "**#1 build item**" is correct.

### B. `canonical_strong_key` has NO row-level security — and it is the table that would hold the card fingerprint

`supabase/migrations/20260720_golden_records.sql:29` declares
`public.canonical_strong_key`. The RLS DO-block at
`supabase/migrations/20260720_golden_records.sql:107-117` loops over only five
tables:

```sql
  FOREACH t IN ARRAY ARRAY['canonical_entity','entity_alias','merge_candidate','negative_pair','merge_event'] LOOP
```

`canonical_strong_key` is **absent**. It has no `ENABLE ROW LEVEL SECURITY`, no
policy, and no `REVOKE` — it is the one golden table with no gate of any kind,
and it is the table that would hold this track's `card_fp` (and the Item Profile
track's `upc`/`sku`).

**CORRECTED 2026-07-24 — the earlier claim in this section that "it has no
`GRANT SELECT … TO authenticated`, so nothing leaks *today*" does NOT hold and
must not be used as a reason to defer.** This repo defends against Supabase's
*default* privileges explicitly, with a table-level `REVOKE ALL … FROM anon,
authenticated`, in four other migrations — verified first-hand:
`20260716_oidc_rp_sessions.sql:17`,
`20260717_experience_routing_identity_links.sql:16,34,45`,
`20260717_public_commerce.sql:96-98`, `20260717_terms_acceptances.sql:57`. That
defensive pattern only makes sense if the defaults **do** grant. The absence of
an explicit grant is therefore not evidence of safety, and "nothing grants it
today" is not an argument this track may proceed on.

**RESOLUTION — its own migration, landing before both consumer tracks.** The fix
no longer lives inside this brief's feature migration. It is
`supabase/migrations/20260724_canonical_strong_key_rls.sql`, **owned by the Item
Profile track** (`g-item-profile-plugin.md` § "Shared migration —
`supabase/migrations/20260724_canonical_strong_key_rls.sql`"), declared exactly
once, and it carries **both** `ENABLE ROW LEVEL SECURITY` + the member-select
policy **and** `REVOKE ALL ON public.canonical_strong_key FROM anon,
authenticated;`. It sorts before `20260724_entity_note.sql`,
`20260724_item_profile.sql` and this brief's `20260725_customer_profile.sql`, so
whichever track ships first, no production strong key is ever written into an
ungated table. This track **depends on that file and declares none of it** — see
Step 2. Sequencing note: the Item Profile track's Step 5.1 writes a strong key
for **every catalog row**, so this file must land before that step runs, not
merely before this track's ingest.

Do **not** edit `20260720_golden_records.sql` to fix it in place — history stays
replayable, the fix is additive.

The repo's own lint at `scripts/check-migration-safety.mjs:32-40` did not catch
it because its RLS check uses a 4000-character proximity regex
(`` new RegExp(`${t}[\\s\\S]{0,4000}enable\\s+row\\s+level\\s+security`) ``) which
matches the neighbouring DO-block. Do not rely on that lint to prove this fix.

### C. The 409 install gate — copy EDI Invoices, NOT `/api/documents/*`

`src/server.ts:2617` is the real gate. Read it in full:

```ts
async function hasActiveAppEntitlement(tenantId: string, appKey: string): Promise<boolean> {
  try {
    const supabase = createSupabaseAdmin();
    const { data } = await supabase
      .from('marketplace_app_entitlements')
      .select('status')
      .eq('tenant_id', tenantId)
      .eq('app_key', appKey)
      .maybeSingle();
    return data?.status === 'active';
  } catch {
    return false;   // fails CLOSED
  }
}
```

`src/server.ts:2632` `const EDI_APP_KEY = 'edi-invoices';`

The four call sites to copy verbatim are `src/server.ts:6099`, `:6114`, `:6144`,
`:6159`. Example, `src/server.ts:6096-6099`:

```ts
async function handleEdiList(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const auth = await authenticateRequest(req);
  if (!auth) return json(res, 401, { error: 'Authentication required' });
  if (!(await hasActiveAppEntitlement(auth.tenantId, EDI_APP_KEY))) return json(res, 409, { error: 'The EDI Invoices app is not installed for this workspace. Install it from the Marketplace to view supplier invoices.' });
```

The journey doc's instruction to "copy `/api/documents/*`" is **wrong** —
Documents uses a token-minting provisioning path (`provisionDocumentsAccess`,
called from `src/server.ts:3009`), a different model. Use EDI.

Route registration lives in one big dispatch chain; the EDI entries are at
`src/server.ts:6953-6966`. Add the `/api/customers/*` routes in the same style.

### D. Tenant → store scoping is already solved: `resolveDigestScope`

`src/server.ts:3982`:

```ts
async function resolveDigestScope(tenantId: string): Promise<DigestScope | null> {
  try {
    const supabase = createSupabaseAdmin();
    const { data: rows } = await supabase
      .from('tenant_connectors')
      .select('type, config')
      .eq('tenant_id', tenantId)
      .eq('type', 'rapidrms-api')
      .eq('status', 'connected')
      .limit(1);
    const row = rows?.[0];
    if (!row) return null;
    const config = (row.config ?? {}) as Record<string, unknown>;
    const clientId = String(config.clientId ?? '').trim();
    if (!clientId) return null;
    return { provider: 'rapidrms', storeId: clientId.startsWith('client-') ? clientId : `client-${clientId}` };
  } catch (err) { /* ... */ return null; }
}
```

Probed live read-only: `rapidrms.payment_transaction.store_id` values are exactly
`'client-2'` and `'client-180727'` — the same namespace this function produces.
**No new tenant→store mapping is needed. Reuse this function.**

**UNVERIFIED:** the mapping was confirmed *structurally* only. No
`tenant_connectors` row was read (that is production app data), so no specific
tenant's `clientId` was matched to a `store_id`. Verify by reading one
`tenant_connectors` row for the pilot tenant and confirming
`'client-' || config.clientId` exists in `rapidrms.payment_transaction.store_id`.

### E. The proven warehouse-read pattern: `handleOwnerDigest`

`src/server.ts:4010` (constants at `:855` and `:4007`) — the **only** working
warehouse-read seam from the aros server:

```ts
const SHRE_RAPIDRMS_URL = process.env.SHRE_RAPIDRMS_URL || 'http://127.0.0.1:5443';  // src/server.ts:855
const OWNER_DIGEST_TTL_MS = 60_000;                                                   // src/server.ts:4007
```

Shape: `authenticateRequest` → `resolveDigestScope` → `fetch(SHRE_RAPIDRMS_URL...)`
with `AbortSignal.timeout(5000)` → 60s TTL cache keyed on `tenantId` → **fail-soft**
to `{ digest: null, error: 'unavailable' }` with HTTP 200. That fail-soft contract
gives the journey's *"We couldn't reach your register just now"* state for free.

### F. There is NO server-side READ path to Cortex — an open architecture decision

- `connectors/cortex-bridge.ts:48` `replicateSnapshotToCortex()` is **write-only**
  and opt-in via `CORTEX_URL` / `AROS_CORTEX_BRIDGE`.
- The only Cortex *reader* in the repo is `connectors/rapidrms/analytics-connector.ts`,
  which loads Postgres credentials from `~/.shre/vault` files at
  `connectors/rapidrms/analytics-connector.ts:55` (`readVaultFile`) — a
  developer-workstation pattern, not deployable.

See [Stop conditions — open decisions](#stop-conditions--open-decisions-come-back-to-the-founder) Q3.

### G. `skills/src/skills/customer-profiler.ts` — harvest verdict: **LEAVE**

267 lines. Its own header, `skills/src/skills/customer-profiler.ts:12-18`:

```
 * Note: Most c-stores don't have loyalty programs, so we profile
 * by payment method fingerprint + time patterns. Phase 2 will
 * add receipt phone number / loyalty card matching.
 *
 * For Phase 1, we aggregate at the store level to identify
 * customer segments and shopping patterns.
```

It is **store-level segment analysis** (hour-of-day, day-of-week, ticket-size
bands, `repeatIndicator = customer_count / transactions`). It has **zero card
identity keying**. Two further reasons to leave it:

1. It consumes `connector.getInvoices()` at
   `connectors/rapidrms/analytics-connector.ts:97`, whose SQL selects
   `ir.bill_amount, ir.tax_amount, ir.discount_amount, ir.payment_method,
   ir.is_void, ir.is_refund, ir.shift, ir.customer_count` from
   `rapidrms.invoice_report` — **eight columns that do not exist** (the real
   ones are `grand_total`, `tax_total`, `discount_total`, `payment_type`,
   `status`). The query errors outright, so the skill has never returned a row.
   That file also string-interpolates `this.storeId` into SQL
   (`connectors/rapidrms/analytics-connector.ts:641`, `:671`, `:681`) — a SQL
   injection seam. **Do not build Phase 3 on this file.**
2. `skills/package.json:2` names the package `@aros/skills`; a repo-wide grep for
   `@aros/skills` returns only `skills/package.json` and `skills/package-lock.json`.
   **Imported by nothing.**

Carry forward only the *shape* of its pure aggregation loops (Map-reduce over
rows, no I/O) as a style precedent. Copy no logic. Delete nothing.

### H. The shell seams for a new in-shell section (small, complete list)

| Anchor | What it is |
|---|---|
| `apps/web/src/redesign/shellData.ts:9-11` | `SectionKey` union — ends `\| 'edi-invoices';` |
| `apps/web/src/redesign/shellData.ts:37-40` | `export const EMBEDDED_APP_NAV: Record<'documents' \| 'edi-invoices', NavItem>` |
| `apps/web/src/redesign/shellData.ts:118` | `'edi-invoices': { ... }` section content entry |
| `apps/web/src/redesign/shellData.ts:284` | `SECTION_TITLES` map, includes `'edi-invoices': 'EDI Invoices'` |
| `apps/web/src/redesign/routes.ts:13` | `PATH_TO_SECTION` — `'/edi-invoices': 'edi-invoices',` |
| `apps/web/src/redesign/routes.ts:31` | `SECTION_TO_PATH` — `'edi-invoices': '/edi-invoices',` |
| `apps/web/src/redesign/AppShell.tsx:97` | `installedApps` state, seeded from `EMBEDDED_APP_NAV` keys in demo |
| `apps/web/src/redesign/AppShell.tsx:113-115` | `installedAppNav` — filters `EMBEDDED_APP_NAV` by entitlement |
| `apps/web/src/redesign/shellData.ts:117` | `SECTIONS: Record<Exclude<SectionKey,'chat'>, SectionSpec>` — **exhaustive**, so adding a `SectionKey` without adding an entry here fails `pnpm typecheck` |
| `apps/web/src/redesign/AppShell.tsx:181-187` | `renderSection()` entitlement gate → `<AppInstallPrompt>` when not installed |
| `apps/web/src/redesign/AppShell.tsx:190` | `return demo ? <SectionPanel …/> : <EdiInvoices />` — the demo branch renders the **fake** `SECTIONS` rows at `shellData.ts:118-126`. Do not route this track through it |
| `apps/web/src/app/App.tsx:40` | `KNOWN_PREFIXES` — a path missing from it renders a **404 for signed-out visitors** (`App.tsx:170`) |
| `apps/web/src/app/App.tsx:43-52` | `ROUTE_TITLES` — `['/edi-invoices', 'EDI Invoices — AROS']` at `:50` |
| `apps/web/src/redesign/pages/EdiInvoices.tsx` | 554-line reference page for an in-shell app |

**CORRECTED 2026-07-24 — an earlier revision of this section said "there is no
`apps/web/src/App.tsx` … do not look for `KNOWN_PREFIXES`; it does not exist in
this repo." That is wrong and it drops two required edits.** The file is
`apps/web/src/app/App.tsx` (note the `app/` segment), and `KNOWN_PREFIXES` is at
`:40`. Registering a section in `routes.ts` alone leaves `/customers` 404-ing for
signed-out visitors and titled with the generic fallback. See Step 8.

### I. Ship as an **App**, not a "Plugin"

`apps/web/src/redesign/pages/connections/MarketplacePage.tsx:24`:

```ts
const PLUGINS = [['mcp-client','Universal MCP Client','Connect approved MCP servers'], ['retail-toolkit','Retail Operations Toolkit','Store-aware operations tools']] as const;
```

rendered at `MarketplacePage.tsx:64` behind
`<button className="rsx-card__btn" disabled title="Tenant-scoped authorization bridge required">Coming soon</button>`.
The Plugins tab is dead. The **Apps** tab is the wired path.

The app catalog row template is `supabase/migrations/20260720_embedded_marketplace_apps.sql:11`:

```sql
INSERT INTO public.platform_apps(id,name,launch_url,repo,vault_namespace,required_scopes,status,description,embedded) VALUES
('edi-invoices','EDI Invoices','/edi-invoices','Shreai/aros/apps/web','shre/aros/edi-invoices',ARRAY['edi:read'],'active','Supplier EDI invoices synced from your store connections.',true)
```

`platform_apps` DDL: `supabase/migrations/20260715_setup_resources.sql:60`, with
`vault_namespace text NOT NULL` at `:62`. **UNVERIFIED-BY-CODE-USE:**
`vault_namespace` is never read by any server code (repo-wide grep finds it only
in this DDL, the INSERTs, and as an optional field in
`apps/web/src/redesign/pages/connections/api.ts`). It is declarative metadata —
**it is not a working salt fetch.**

Activation flow: `handlePlatformApps` at `src/server.ts:2978` serves
`GET /api/apps` (route `src/server.ts:7080`) and
`POST /api/apps/:id/grant` (route `src/server.ts:7088`), which upserts
`marketplace_app_entitlements` at `src/server.ts:3006`.

**Gap the journey depends on:** the activation dialog at
`MarketplacePage.tsx:65` is **one generic modal shared by every app** (scopes
checklist, bundle note, Activate). There is **no per-app pre-activation probe
hook**. The journey's step-2 blocking live check is net-new shared UI.

### J. `entity_note` does not exist

Repo-wide grep for `entity_note` across `*.ts` and `*.sql` returns **nothing**.
The journey's note box is genuinely net-new, and is **shared with the Item
Profile track (`g-item-profile-plugin`), which owns its DDL** in
`supabase/migrations/20260724_entity_note.sql`. This track does not declare the
table — it writes `entity_type='customer'` rows into it. See Step 2 and
[Collision warnings](#collision-warnings).

### K. There is no vault in this repo for the per-tenant salt

- `connectors/vault-ref.ts:17` — the "Vault Reference Manager" is an in-process
  `new Map()`. AES-256-GCM + scrypt with a random per-value salt, **lost on
  restart**. It cannot hold a stable per-tenant hashing salt.
- `src/server.ts:3674` — an explicit
  `// TODO: move key custody to shre-secrets vault (:5473) once commissioned.`
- `src/server.ts:3691-3694` — the only per-tenant key-derivation seed that exists:

```ts
/** Per-tenant vault key-derivation seed — used by both connector test and data fetch. */
function vaultSecretFor(tenantId: string): string {
  return `${tenantId}:${process.env.AROS_ENCRYPTION_KEY || 'aros-dev'}`;
}
```

C1 says "salt is per-tenant and vault-held". **State the truth in code and in the
brief: there is no vault client in aros today.** The mechanism this brief
mandates is in [Data contract §Salt custody](#salt-custody-c1-corrected).

### L. C1 as literally written cannot be implemented — there is no processor token

C1 says "a salted hash of the **processor token**". Probed live over the 13,288
card rows in `rapidrms.payment_transaction`:

| Column | Distinct values | Meaning |
|---|---|---|
| `transaction_no` | 13,134 | per-transaction, not per-card |
| `auth_code` | 12,981 | per-transaction, not per-card |
| `pay_id` | **1** | constant across every row |

**No token exists.** C1's *intent* — no PAN, salted, per-tenant, not portable —
survives intact and is fully honoured by hashing `brand | last4`. Its literal
wording is corrected here and must be corrected in the mission doc.

### M. The seed numbers in both contract docs are an order of magnitude wrong

Both `docs/missions/retail-profiles.md` (D1: "476 payment rows", "232 vs 237
identities", "51% name coverage") and `docs/journeys/see-who-comes-back.md`
("PARTIAL — verified present on ~2% of invoices, 456 of 20,405") measured
`rapidrms.invoice_report.raw_data->'invoicePaymentDetail'`, which covers only
**1,043 of 20,980 invoices (5%)**.

The real source is a **normalized table neither doc names**:
`rapidrms.payment_transaction` — 20,511 rows, `relkind 'r'`, owner `aros_cortex`,
`max(synced_at) = 2026-07-23 08:56Z`. `rapidrms_analytics.card_activity_log` is
just a view over it (confirmed via `pg_get_viewdef`).

Its 21 columns are: `id, invoice_no, invoice_date, bill_amount, return_amount,
surcharge_amount, tips_amount, card_type, acc_no, pay_mode, card_int_type,
card_holder_name, transaction_no, auth_code, pay_id, register_id, cashier_name,
store_id, company_id, branch_id, synced_at`.

**There is no expiry column.** The docs' "expiry as an extra discriminator
(247 rows)" comes from the 1,043-row `raw_data` sliver only. **Drop expiry from
the key design entirely.**

Corrected live figures (window 2026-04-15 .. 2026-07-23, 99 days):

| Figure | Value |
|---|---|
| Payment rows | 20,511 |
| Rows with card brand + last-4 | 13,288 (64.8%) |
| Distinct invoices covered | 13,264 (100% join to `invoice_line_item`) |
| Rows also carrying a cardholder name | 9,948 of 13,288 (74.9%) |
| Distinct identities, `brand+last4` | **4,851** |
| Distinct identities, `brand+last4+normalized(name)` | **5,719** |
| Repeat identities (`brand+last4`, >1 invoice) | 2,160 (44.5%) |
| Identities with no name on any row | 1,572 of 4,851 (32.4%) |
| `brand+last4` groups with >1 distinct name (real collisions) | 305 |
| `brand+last4` groups mixing named and unnamed rows (same card) | 80 |
| `brand+last4` identities appearing at >1 `store_id` | 234 |

### N. Founder decision D1 does not hold at scale — the failure mode inverts

D1 states the cardholder name *resolved 5 collisions (~2%)*. At full volume the
name **ADDS 868 identities (+17.9%)**: 4,851 → 5,719. Naive triple-keying
**over-fragments one shopper into several identities**, which is the opposite of
the problem D1 guards against.

**This brief therefore keys the strong key on `brand + last4` only, and treats
the cardholder name as a merge/split *signal* routed to `merge_candidate` — never
as a component of the primary key.** This is a founder-visible change to D1. See
[Stop conditions — open decisions](#stop-conditions--open-decisions-come-back-to-the-founder) Q1. The key composition is
implemented as **declarative data** so either founder answer is a one-constant
change, not a rewrite.

### O. `acc_no` is not a clean last-4 and must be normalized before hashing

PCI status is **CLEAN** — zero values contain a run of ≥5 digits, so no PAN is
present. But the digit-shape distribution (measured as a digits-vs-non-digits
mask, so **no card value was ever selected**) is:

| Shape | Count |
|---|---|
| `DDXXXXXXXXXXDDDD` (2 leading digits + mask + last 4) | 11,891 |
| `XXXXXXXXXXXXDDDD` | 125 |
| `DDDD` (bare 4 digits) | 1,256 |
| 3 non-digit characters | 5 |
| empty string | 7,218 |
| stragglers at length 13 / 15 / 18 | 16 |

Storing `acc_no` verbatim would persist **2 BIN digits beyond what C1 permits**.
The pure normalizer must be "take the last 4 characters, reject unless they are
exactly 4 digits", with unit tests over all seven shapes.

**UNVERIFIED:** that the two leading digits are a BIN prefix rather than another
artefact — the shape was inferred from a mask aggregation, deliberately, so that
no card value was read. The PCI-relevant fact (no run of ≥5 digits anywhere) *is*
directly verified. Verifying the BIN hypothesis would require reading actual
values and is **not** authorised.

### P. `rapidrms.payment_transaction` is not in the repo of record — a C4 exposure

The table exists in prod Cortex (owner `aros_cortex`) but the string
`payment_transaction` appears **nowhere** in aros `origin/main`. The only repo
artefact is an **untracked, unmerged** file sitting in the dirty primary
checkout — `supabase/migrations/20260716_rapidrms_invoice_derivations.sql` —
which is itself drifted (it inserts columns `transaction_id, card_no,
payment_type, amount, transaction_date, status, gateway_type, raw_data` that do
not match the live table), and `pg_trigger` shows **no triggers** on
`rapidrms.invoice_report`, so it is not what populates prod. The real writer is
the `shre-rapidrms` sync service in `Nirlabinc/shreai`.

Under **C4 — no number without a verified data contract**, this must be pinned
(owner, column list, refresh cadence, stability guarantee) before a figure is
rendered to a tenant. See [Stop conditions — open decisions](#stop-conditions--open-decisions-come-back-to-the-founder) Q5.

**UNVERIFIED:** whether the `shre-rapidrms` warehouse service exposes, or could
cheaply expose, a customer/card endpoint. That code is in `Nirlabinc/shreai`; a
ripgrep over the primary shreai checkout timed out and tree-mutating git commands
were not run there. Verify by reading `Nirlabinc/shreai` `shre-rapidrms/src/`
route registration.

### Q. Reusable warehouse assets the seed did not know about

- `rapidrms_analytics.rfm_segmentation` — 5,996 rows, 1,986 with `frequency > 1`,
  **already keyed on `card_last4 + card_network + card_holder`** and carrying
  recency/frequency/monetary, segment, tier, recommended_action. `shre_router_ro`
  already has `SELECT` on it (`has_table_privilege` = true), and on
  `rapidrms_analytics.card_activity_log` and `rapidrms.payment_transaction`.
  **UNVERIFIED:** whether it partitions by store. Row counts and key columns were
  read; the view definition was not. **Run `pg_get_viewdef` before binding to it**
  — an unpartitioned view is a C3 cross-store leak.
- `rapidrms.customer_transaction` — 13,359 rows. A house-account / `custId`
  identity path nobody has evaluated. **Out of scope for this track.**

---

## Depends on / blocks

### Depends on

| Dependency | Kind | State |
|---|---|---|
| Golden-record layer (`resolveCanonical`, `createGoldenStore`, the six tables, `claim_strong_key`) | in-repo, merged on `main` | **Ready.** Bind, do not fork. |
| `resolveDigestScope` tenant→store mapping (`src/server.ts:3982`) | in-repo, merged | **Ready.** Reuse. |
| `hasActiveAppEntitlement` install gate (`src/server.ts:2617`) | in-repo, merged | **Ready.** Copy the EDI usage. |
| A Cortex read path (see F) | **MISSING** | **Blocking for real numbers.** Q3 must be answered. Steps 1, 2 and the interface half of 4 are unblocked; `createWarehousePaymentSource()` is not. |
| `AROS_ENCRYPTION_KEY` present in the deploy environment and ≠ the `'aros-dev'` fallback | ops | **UNVERIFIED.** Must be confirmed before the app is activatable in prod. |
| Legal/privacy sign-off for storing a card fingerprint + purchase history | founder/legal | **UNVERIFIED — hard deploy gate.** The journey lists it as mirroring `TERMS_GATE_ENABLED`. The `TERMS_GATE_ENABLED` machinery exists (`src/terms/gate.ts`, `src/terms/constants.ts:21`) but no sign-off record was found either way. |
| Founder answers to Q1 (revised D1) and Q2 (C3 store scoping) | founder | **Blocking before any number ships to a tenant.** Not blocking for steps 1–2. |
| Journey spec **Q15** — `docs/journeys/see-who-comes-back.md` is `STATUS: DRAFT — founder approval required before any schema` (verified: `git show origin/docs/retail-profiles:docs/journeys/see-who-comes-back.md`) | founder | **Blocking for Step 2's `20260725_customer_profile.sql`** and for Steps 6–9. Not blocking Step 1 or the `canonical_strong_key` fix. |
| Founder ratification **Q13** — `'card_fp'` into `STRONG_KEYS.customer` | founder | **Blocking for Step 3, before Step 1 is opened.** The only edit to merged golden-record code in this package. |
| Founder answer **Q8** — the owner-facing name | founder | **Blocking for Steps 6–9.** It fixes `/customers`, the `platform_apps.id`, the nav key and every UI string; renaming after those ship is a migration. |

### Blocks / shares with

- **`g-item-profile-plugin`** (Item Profile, retail-profiles Phase 2): shares the
  `entity_note` table and the `canonical_strong_key` RLS/REVOKE fix. Sequencing
  rules are in [Collision warnings](#collision-warnings).
  - **`public.canonical_strong_key` RLS + REVOKE — that track owns the DDL**, in
    its own migration `supabase/migrations/20260724_canonical_strong_key_rls.sql`
    (Item Profile brief § Shared migration). This track **depends on it and
    declares none of it**; the block that used to sit at the top of this brief's
    migration is gone. Same rule as `entity_note`: if the file has not landed
    when this track reaches Step 2, copy it **byte-identically** from the Item
    Profile brief — one source of text, always — and never author a variant.
    That file can land ahead of *both* tracks' founder gates; it is a security
    fix, not a feature.
  - **`public.entity_note` — that track owns the DDL**, in its own migration
    `supabase/migrations/20260724_entity_note.sql`. This track **depends on it
    and never re-declares it**; this brief's migration is dated `20260725` so the
    owner sorts first. If that file has not landed when this track reaches
    Step 2, copy it byte-identically from the Item Profile brief
    (§ Shared migration) — one source of text, always.
  - It does **not** share `src/golden/resolve.ts` — that file is edited by this
    track only (Step 3, Q13). The Item Profile track binds to the golden layer
    without altering it.
- Phase 4 (register name + exception alerts) is unrelated. Do not touch it.

---

## Data contract

### Salt custody (C1, corrected)

**There is no vault client in the aros repo** (see ground truth K). Do **not**
write code that claims a vault fetch. The mechanism is:

```
salt(tenantId) = HMAC-SHA256(key = AROS_ENCRYPTION_KEY, msg = 'customer-card-fp:v1:' + tenantId)
```

- `AROS_ENCRYPTION_KEY` is injected by the deploy secret store. It is already
  read at `src/server.ts:3686` and `src/server.ts:3693`.
- **Hard startup refusal:** if `AROS_ENCRYPTION_KEY` is absent, shorter than 32
  characters, or equal to the string `'aros-dev'`, the Customers ingest and every
  `/api/customers/*` handler must return `503 { error: 'Customers is not
  configured on this server.' }` and log `[customers] refusing: AROS_ENCRYPTION_KEY
  missing or dev fallback` **once at startup**. Never fall back to a dev salt for
  a real hash.
- The salt value is **never** logged, never returned, never persisted.
- Leave a code comment pointing at `src/server.ts:3674` and stating that migration
  to shre-secrets (`:5473`) is the documented follow-up.

### The fingerprint

```
card_fp = sha256hex( salt(tenantId) + '|' + storeScope + '|' + brandNorm + '|' + last4 )
```

- `storeScope` is `resolveDigestScope(tenantId).storeId`, e.g. `'client-2'`.
  **Including it in the hash input is the C3 guarantee**: identities can never
  merge across stores, even if a tenant later maps two. The cost is that a
  two-store tenant sees the same shopper twice — that is the correct, patent-safe
  behaviour and the UI must say **"at this store"**.
- `brandNorm` = uppercase, trimmed, non-alphanumerics collapsed
  (`VISA`, `MASTERCARD`, `DISCOVER`, `AMEX`, `DEBIT`).
- `last4` = the normalizer's output (see below).
- **No PAN, no expiry, no cardholder name, no processor token enters this hash.**

### The holder signal (PII — hashed, never stored in clear, never returned)

```
holder_fp = sha256hex( salt(tenantId) + '|holder|' + normalizeHolder(card_holder_name) )
```

`holder_fp` exists **only** to answer "did the name on this card change?". It is
low-entropy and is therefore treated as **PII-equivalent at rest**: never in an
API response, never in a log line, never in a `merge_candidate` payload. The
clear-text `card_holder_name` is read from the warehouse, hashed in memory, and
discarded in the same function — it is **never written to any aros table and
never crosses the HTTP boundary**.

**Where it is stored — a service-role-only sidecar, NOT a column on the
member-readable rollup.** `holder_fp` lives in its own table,
`public.customer_card_holder_fp`: RLS enabled, **no policy, no grant**, plus an
explicit `REVOKE ALL … FROM anon, authenticated`. `public.customer_card_rollup`
— the table tenant members *can* read through PostgREST — has **no `holder_fp`
column at all**.

**Why the sidecar and not a column-level grant (read this before "simplifying"
it back).** An earlier revision of this brief kept `holder_fp` on
`customer_card_rollup` and tried to protect it with
`REVOKE SELECT (holder_fp) ON public.customer_card_rollup FROM authenticated;`
issued **after** the DO-loop's table-level `GRANT SELECT ON … TO authenticated`.
That is a **documented PostgreSQL no-op**: the REVOKE reference states *"if a
role has been granted privileges on a table, then revoking the same privileges
from individual columns will have no effect."* Postgres emits a warning and
leaves `SELECT` on **all** columns intact — so the hashed cardholder name was
readable by every active member of the tenant, next to `card_brand`,
`card_last4`, `visits`, `total_spend_cents` and the seen-at timestamps, i.e. a
stable per-consumer identity token derived from the cardholder NAME sitting on
the owner-side surface C3 draws a hard boundary around. Nothing in the acceptance
suite caught it, because T5 only serialises handler projections and cannot see a
direct PostgREST read.

A correct column-list grant (`GRANT SELECT (col, col, …)` omitting `holder_fp`,
with no table-level grant anywhere) *would* also work. It is rejected because it
is one careless copy-paste of the standard DO-loop away from being undone, and
because it silently re-exposes the column set every time someone adds a column.
The sidecar makes the safe state structural: **no grant on the member-readable
table can ever reach `holder_fp`, because `holder_fp` is not on it.** It also
fits the aggregate shape better — `CardAggregate.holderFps` is a *set* (its
length > 1 is the merge signal), which a single column could never hold.

### Key composition — declarative data (survives either founder answer)

```ts
// src/customers/keys.ts — rules as data, per PROGRAMMING_STYLE.md
export type KeyComposition = 'brand_last4' | 'brand_last4_holder';

/** DEFAULT. Founder decision Q1 pending — see docs/briefs/h-customer-profile-plugin.md.
 *  Do NOT switch to 'brand_last4_holder' without written founder approval:
 *  at full volume the holder name ADDS 868 identities (4,851 -> 5,719, +17.9%),
 *  i.e. it over-fragments one shopper rather than resolving collisions. */
export const CARD_KEY_COMPOSITION: KeyComposition = 'brand_last4';
```

### Pure functions (the functional core — no I/O, plain-assert testable)

All in `src/customers/` and importable with **zero** Node/Supabase/fetch imports.

```ts
/** src/customers/normalize.ts */
export function normalizeLast4(accNo: string | null | undefined): string | null;
//  '12XXXXXXXXXX4412' -> '4412' | 'XXXXXXXXXXXX0071' -> '0071' | '4412' -> '4412'
//  ''  -> null | '***' -> null | null -> null | '123' -> null
//  Rule: take the last 4 characters; return them only if all 4 are ASCII digits.

export function normalizeBrand(cardType: string | null | undefined): string | null;
//  ' visa ' -> 'VISA' | 'Master Card' -> 'MASTERCARD' | '' -> null

export function normalizeHolder(name: string | null | undefined): string | null;
//  '  ramesh   patel ' -> 'RAMESH PATEL' | 'PATEL/RAMESH' -> 'PATEL RAMESH' | '' -> null

/** src/customers/fingerprint.ts — takes the salt as an ARGUMENT (no env read). */
export function cardFingerprint(salt: string, storeScope: string, brand: string, last4: string): string;
export function holderFingerprint(salt: string, holder: string): string;

/** src/customers/confidence.ts */
export type Confidence = 'high' | 'low';
export function confidenceOf(i: { hasHolder: boolean; holderAgrees: boolean | null }): Confidence;
//  hasHolder=false                      -> 'low'   (1,572 of 4,851 identities)
//  hasHolder=true,  holderAgrees=true   -> 'high'
//  hasHolder=true,  holderAgrees=false  -> 'low'   (+ caller flags merge_candidate)

/** src/customers/aggregate.ts — the entire analytics, pure Map-reduce over rows. */
export interface PaymentRow {
  invoiceNo: string; invoiceDate: string;   // ISO date
  cardType: string | null; accNo: string | null; cardHolderName: string | null;
  billAmountCents: number; storeId: string;
}
export interface CardAggregate {
  cardFp: string; brand: string; last4: string;
  visits: number;               // DISTINCT invoiceNo
  totalSpendCents: number; avgBasketCents: number;
  firstSeenAt: string; lastSeenAt: string;
  hourHistogram: number[];      // length 24
  confidence: Confidence;
  holderFps: string[];          // distinct; length > 1 => merge_candidate
}
export interface TopLine {
  windowStart: string; windowEnd: string;
  cardPayments: number; distinctCards: number; repeatCards: number; repeatPct: number;
  paymentRowsTotal: number; rowsWithoutCard: number;   // honesty: cash + uncarded
}
export function aggregateCards(rows: PaymentRow[], salt: string, storeScope: string): {
  aggregates: CardAggregate[]; topLine: TopLine; skipped: number;
};
```

**Absolute rule:** no second identity table, no local card→customer map, no
`customer_id` minted anywhere but `canonical_entity`.

### Resolver binding (D2 — the complete change)

`src/golden/resolve.ts:58` becomes:

```ts
  customer: ['phone_hash', 'email_hash', 'card_fp'],
```

Ingest calls, per aggregated card:

```ts
await resolveCanonical(createGoldenStore(), {
  tenantId,
  entityType: 'customer',
  sourceSystem: 'rapidrms',
  sourceId: `${storeScope}:card:${cardFp}`,   // stable, non-PII, idempotent
  matchKeys: { card_fp: cardFp },
  // displayName: DELIBERATELY OMITTED. canonical_entity.display_name has no
  // PII classification and is readable by any tenant member — never put the
  // cardholder name (or anything derived from it) here.
});
```

When `agg.holderFps.length > 1`, additionally call
`createGoldenStore().flagCandidate({ tenantId, entityType: 'customer',
canonicalId, candidateIds: [canonicalId] })` — the payload carries **no name**.

### Migration — `supabase/migrations/20260725_customer_profile.sql`

RLS is in the same migration, for every table this file creates, per house rule.

**Filename note (do not "fix" it back).** The date prefix is `20260725`, one day
after this brief was written, so that **both** files this track depends on and
declares none of — `supabase/migrations/20260724_canonical_strong_key_rls.sql`
and `supabase/migrations/20260724_entity_note.sql`, both owned by the Item
Profile track (`g-item-profile-plugin.md` § Shared migration) — sort **before**
this file on a fresh apply.

**Applied order (the package-wide authoritative list is `README.md`
§ "Migration apply order"; these are the four Phase 2/3 files in it):**

```
20260724_canonical_strong_key_rls.sql  ← security fix (owner: Item Profile / G)
20260724_entity_note.sql               ← shared note box (owner: Item Profile / G)
20260724_item_profile.sql              ← Item Profile's own tables (owner: G)
20260725_customer_profile.sql          ← THIS FILE (renamed to sort after all three)
```

Lexical order is the only thing enforcing that (`c` < `e` < `i`, then the later
date). It has already bitten this package once: this file was
`20260724_customer_profile.sql`, which sorts `c` < `e` — **before** its own
`entity_note` owner. **Do not rename any of these four**, and if you must, re-derive
README § "Migration apply order" first and update it in the same PR.

**This file must contain no `entity_note` DDL.**

**Note bodies go through the package's ONE PAN redactor.** `entity_note.body`
(written here by `POST /api/customers/cards/:canonicalId/notes`) is owner-typed
free text on the **customer** entity — the single most likely place in this repo
for someone to type a full card number. Apply `redactPan(body.trim())` before the
insert, importing it from `src/chat/redact.ts` — the single owner, spec in
`d-actionable-errors.md` §Data contract **6a** (Luhn-gated, marker
`'[redacted-card]'`, shared fixtures at `src/chat/__fixtures__/pan-redaction.json`).
**Do not write a second PAN rule in `src/customers/`**: three briefs each invented
their own redactor and two disagreed about what a PAN is — that is now settled to
one primitive, and forking a shared safety primitive is a stop condition. Extend
T5 (§Acceptance) with: a note body containing a Luhn-valid PAN is stored
redacted; `'sku 123456789012'` is stored byte-identical.

**Actor stamp — inherited, not invented (ai-activity-spine).** Read
`COORDINATION-ai-activity-spine.md` and `a-conversation-persistence.md`
§ "Bind to the AI activity spine". AROS has exactly **one** attribution path:
`tenant_id` (= the spine's `workspace_id`) plus the server-resolved acting
`user_id` (= `actor_user_id`), FK-enforced, never client-supplied. This track
binds to it and adds nothing of its own — **no actor table, no AI-activity feed,
no conversation/turn store.** Concretely: `entity_note.created_by` is the acting
user; `customer_profile_run` rows are attributed by `tenant_id` **and by
`triggered_by uuid REFERENCES auth.users(id) ON DELETE SET NULL`** — declared in
the migration below, populated by Step 5 from the server-resolved session, never
client-supplied. `NULL` means *scheduled/system run*; a run started by a human
through `POST /api/customers/refresh` (owner/admin only) **must** carry that
user's id. A run that changes what a tenant is shown with **no** record of who
started it is the spine's stated failure signal ("any AI action executes with no
actor stamp → that is a bug, not a default"), so this column is a **stop
condition, not a nice-to-have**: if it is missing from the DDL when you reach
Step 5, add it — do not drop the requirement. It is one column, not a `meta`
jsonb: an FK-enforced actor is exactly what the spine binds on, and a blob key
cannot be FK'd, indexed, or proven present. Any AI turn this track's
surfaces produce is persisted by **track A**, in its append-only per-message
rows: Centrix's jsonb-blob + 30-minute-TTL shape is adopted for **attribution
only** and **rejected for persistence**.

```sql
-- ── Customer Profile (retail-profiles Phase 3) ─────────────────────────────
-- Owner-side, pseudonymous, per-store card frequency. NOT REGULARS: no consumer
-- account, no consent tier, no cross-merchant portability (US Prov. 64/113,480).
-- PCI: no PAN. Only card brand + last-4 (display) and a per-tenant salted
-- fingerprint (identity). Cardholder name is NEVER stored in clear.

-- (0) canonical_strong_key RLS + REVOKE is NOT declared here.
--     It ships in supabase/migrations/20260724_canonical_strong_key_rls.sql,
--     OWNED by the Item Profile track (g-item-profile-plugin.md § Shared
--     migration). That file sorts before this one and before
--     20260724_item_profile.sql, so no track writes a production strong key
--     into an ungated table. DO NOT add an ALTER/POLICY/REVOKE for
--     canonical_strong_key to this file — one declaration, one owner, exactly
--     like entity_note below. See Step 2 and § Verified ground truth B.

-- (1) One ingest run = one provable "as of" + every top-line number sourced.
CREATE TABLE IF NOT EXISTS public.customer_profile_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- ACTOR STAMP (ai-activity-spine) — load-bearing, not decoration.
  -- NULL   = scheduled / system-initiated run (no human triggered it).
  -- NOT NULL = the owner/admin who called POST /api/customers/refresh.
  -- The spine's failure signal is "an action executes with no actor stamp"; a
  -- user-triggered run that changes what a tenant is shown must record WHO
  -- started it. Server-resolved from the authenticated session only — NEVER
  -- client-supplied. ON DELETE SET NULL (not CASCADE): deleting a user must not
  -- delete the run history. Precedent: 20260714_tenant_connectors.sql:16,
  -- 20260715_setup_resources.sql:13, 20260616_marketplace_app_entitlements.sql:10.
  triggered_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  store_scope text NOT NULL,                 -- 'client-2' (resolveDigestScope)
  window_start date NOT NULL,
  window_end   date NOT NULL,
  payment_rows_total int NOT NULL DEFAULT 0, -- rows in window (incl. cash)
  card_rows int NOT NULL DEFAULT 0,          -- rows with brand + last4
  distinct_cards int NOT NULL DEFAULT 0,
  repeat_cards int NOT NULL DEFAULT 0,
  low_confidence_cards int NOT NULL DEFAULT 0,
  source_max_synced_at timestamptz,          -- warehouse freshness, drives "as of"
  status text NOT NULL DEFAULT 'running',    -- running | complete | failed
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_cpr_tenant_scope
  ON public.customer_profile_run(tenant_id, store_scope, completed_at DESC);

-- (2) Per-card rollup. canonical_id FK per C2. NO cardholder name in clear, and
--     NO holder_fp column — see (2a). This table IS member-readable through
--     PostgREST, so every column on it must be safe for any tenant member to
--     select.
CREATE TABLE IF NOT EXISTS public.customer_card_rollup (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES public.customer_profile_run(id) ON DELETE CASCADE,
  canonical_id uuid NOT NULL REFERENCES public.canonical_entity(id) ON DELETE CASCADE,
  store_scope text NOT NULL,
  card_brand text NOT NULL,                  -- 'VISA' — display only
  card_last4 char(4) NOT NULL,               -- PCI-permitted; NEVER more digits
  -- holder_fp DELIBERATELY ABSENT — it lives in customer_card_holder_fp (2a).
  visits int NOT NULL,
  total_spend_cents bigint NOT NULL,
  avg_basket_cents bigint NOT NULL,
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  hour_histogram int[] NOT NULL DEFAULT '{}',
  confidence text NOT NULL CHECK (confidence IN ('high','low')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_card_rollup_last4_digits CHECK (card_last4 ~ '^[0-9]{4}$'),
  UNIQUE (run_id, canonical_id)
);
CREATE INDEX IF NOT EXISTS idx_ccr_run_visits
  ON public.customer_card_rollup(run_id, visits DESC);

-- (2a) holder_fp SIDECAR — SERVICE ROLE ONLY. Never member-readable.
--      holder_fp is a salted hash of the CARDHOLDER NAME: PII-equivalent at
--      rest, low entropy, and a stable per-consumer identity token. It is kept
--      OFF customer_card_rollup on purpose, so that no GRANT on that table can
--      ever reach it — a column-level `REVOKE SELECT (holder_fp)` issued AFTER
--      a table-level GRANT is a documented PostgreSQL NO-OP ("if a role has
--      been granted privileges on a table, then revoking the same privileges
--      from individual columns will have no effect"), which is exactly the bug
--      this shape removes. One row per DISTINCT holder hash per card: a card
--      with >1 row is the name-changed / merge signal (CardAggregate.holderFps).
CREATE TABLE IF NOT EXISTS public.customer_card_holder_fp (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES public.customer_profile_run(id) ON DELETE CASCADE,
  canonical_id uuid NOT NULL REFERENCES public.canonical_entity(id) ON DELETE CASCADE,
  holder_fp text NOT NULL,                   -- salted hash; PII-equivalent; NEVER returned
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_card_holder_fp_hex CHECK (holder_fp ~ '^[0-9a-f]{64}$'),
  UNIQUE (run_id, canonical_id, holder_fp)
);
CREATE INDEX IF NOT EXISTS idx_cchf_card
  ON public.customer_card_holder_fp(run_id, canonical_id);

-- Service-role only: RLS on, NO policy, NO grant, and Supabase's default
-- privileges revoked explicitly — the same posture as public.oidc_rp_sessions
-- (20260716_oidc_rp_sessions.sql:17) and public.terms_acceptances
-- (20260717_terms_acceptances.sql:57). "There is no GRANT so nothing leaks" is
-- NOT a defence in this repo; the REVOKE is load-bearing.
ALTER TABLE public.customer_card_holder_fp ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.customer_card_holder_fp FROM anon, authenticated;

-- (3) Top items per card ("what they usually buy"). Product identity is the
--     Item Profile track's job; this stores the code+name the warehouse gave us.
CREATE TABLE IF NOT EXISTS public.customer_card_top_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES public.customer_profile_run(id) ON DELETE CASCADE,
  canonical_id uuid NOT NULL REFERENCES public.canonical_entity(id) ON DELETE CASCADE,
  item_code text NOT NULL,
  item_name text,
  qty numeric NOT NULL,
  line_count int NOT NULL,
  rank int NOT NULL CHECK (rank BETWEEN 1 AND 5)
);
CREATE INDEX IF NOT EXISTS idx_ccti_canon ON public.customer_card_top_item(run_id, canonical_id, rank);

-- (4) Owner notes: public.entity_note is NOT created here.
--     It is SHARED with the Item Profile track, which OWNS the DDL in its own
--     migration supabase/migrations/20260724_entity_note.sql (see
--     g-item-profile-plugin.md § "Shared migration"). That file sorts before
--     this one and creates the table, its indexes, its RLS policy, its grant and
--     its touch trigger.
--     DO NOT add a CREATE TABLE for entity_note to this file. Both briefs
--     previously declared it with `IF NOT EXISTS` and materially different
--     columns, which makes the second migration a silent no-op and this track's
--     inserts fail at RUNTIME. That is resolved by having exactly one owner.
--     This track writes entity_type='customer' rows; the insert shape is in the
--     Item Profile brief's shared-migration section and is repeated in the
--     HTTP contract notes below.

-- (5) RLS on every new table, member-select only. Writes go through the
--     service role in the app layer (same pattern as 20260720_golden_records).
--     TWO tables are absent from this loop ON PURPOSE:
--       * entity_note              — its RLS ships with its own migration (4).
--       * customer_card_holder_fp  — service-role only; adding it here would
--                                    GRANT SELECT on holder_fp to every tenant
--                                    member and re-open the exact defect (2a)
--                                    exists to close. DO NOT "complete" this
--                                    array.
--     Every column of every table in this loop is member-safe by construction —
--     that is the invariant that lets the grant stay blanket. If you ever add a
--     sensitive column to one of these tables, it goes in its own service-role
--     table; do NOT try to protect it with a column-level REVOKE after this
--     grant, which PostgreSQL documents as a no-op.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['customer_profile_run','customer_card_rollup','customer_card_top_item'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_sel_member ON public.%I', t, t);
    EXECUTE format($f$CREATE POLICY %I_sel_member ON public.%I FOR SELECT
      USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid()))$f$, t, t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
  END LOOP;
END $$;
-- NOTE — there is deliberately NO `REVOKE SELECT (holder_fp) ON
-- public.customer_card_rollup FROM authenticated;` here. An earlier revision had
-- one, and it was a documented PostgreSQL NO-OP after the table-level GRANT
-- above: "if a role has been granted privileges on a table, then revoking the
-- same privileges from individual columns will have no effect." It warns and
-- leaves SELECT on every column intact. The column is gone from this table
-- instead — see (2a). Do not re-add either the column or the REVOKE.

-- (6) Catalog row + the declarative readiness check (journey step 2).
ALTER TABLE public.platform_apps
  ADD COLUMN IF NOT EXISTS readiness_check text;   -- NULL = no pre-activation probe

INSERT INTO public.platform_apps(id,name,launch_url,repo,vault_namespace,required_scopes,status,description,embedded,readiness_check) VALUES
('customers','Customers','/customers','Nirlabinc/aros/apps/web','shre/aros/customers',
 ARRAY['pos:read'],'active',
 'See which shoppers come back and how often. We use only the card type and last 4 digits — never the full card number.',
 true,'card-identity')
ON CONFLICT(id) DO UPDATE SET
  name=EXCLUDED.name, launch_url=EXCLUDED.launch_url, repo=EXCLUDED.repo,
  vault_namespace=EXCLUDED.vault_namespace, required_scopes=EXCLUDED.required_scopes,
  status=EXCLUDED.status, description=EXCLUDED.description, embedded=EXCLUDED.embedded,
  readiness_check=EXCLUDED.readiness_check;
```

### HTTP contract

All routes 401 without auth, **409 when the app is not installed** (exact EDI
wording pattern), 503 when `AROS_ENCRYPTION_KEY` is missing/dev.

```
GET /api/marketplace/readiness/:appId
  -> 200 { ready: true,  check: "card-identity", detail: "Your register tells us the card type and last 4." }
  -> 200 { ready: false, check: "card-identity", reason: "no_connector"      , detail: "First connect your register — that's where the payments come from." }
  -> 200 { ready: false, check: "card-identity", reason: "no_card_detail"    , detail: "Your register doesn't send card details, so we can't tell one shopper from another." }
  -> 200 { ready: null , check: "card-identity", reason: "unreachable"       , detail: "We couldn't reach your register just now." }
  -> 200 { ready: true,  check: null }   // any app with readiness_check IS NULL
  Note: `ready: null` is DISTINCT from `false`. null => "Check again", never activate on an unknown.

GET /api/customers/summary?days=90
  -> 200 {
       asOf: string|null,             // run.source_max_synced_at, ISO
       window: { start: string, end: string, days: number },
       storeScope: string,            // 'client-2'
       topLine: {
         cardPayments: number, distinctCards: number, repeatCards: number, repeatPct: number,
         paymentRowsTotal: number, rowsWithoutCard: number, lowConfidenceCards: number
       } | null,                      // null => nothing to show; UI renders the honest empty state
       state: 'ready'|'no_connector'|'no_card_detail'|'unreachable'|'too_early'|'never_run',
       daysOfHistory: number
     }

GET /api/customers/cards?days=90&limit=50&cursor=<opaque>
  -> 200 { cards: Array<{
       canonicalId: string, brand: string, last4: string,   // NEVER accNo, NEVER holder
       visits: number, totalSpendCents: number, avgBasketCents: number,
       firstSeenAt: string, lastSeenAt: string, confidence: 'high'|'low'
     }>, nextCursor: string|null, asOf: string|null }
  limit is clamped to 200.

GET /api/customers/cards/:canonicalId
  -> 200 { canonicalId, brand, last4, visits, totalSpendCents, avgBasketCents,
           firstSeenAt, lastSeenAt, hourHistogram: number[24], confidence,
           topItems: Array<{ itemCode: string, itemName: string|null, qty: number, rank: number }>,
           notes: Array<{ id: string, body: string, createdAt: string }>,
           mightBeSameAs: Array<{ canonicalId: string, brand: string, last4: string }>,  // from merge_candidate; [] if none
           asOf: string|null }
  -> 404 if the canonical_id is not this tenant's.

POST /api/customers/cards/:canonicalId/notes   { body: string }   -> 201 { id, body, createdAt }
DELETE /api/customers/notes/:noteId                                -> 204

POST /api/customers/refresh    (owner|admin only, rate-limited 3/5min)
  -> 202 { runId } | 409 not installed | 429
```

**Note reads and writes go through the shared `public.entity_note` table**
(owned by the Item Profile track — see Step 2). This track's rows always carry
`entity_type = 'customer'` and `entity_key = canonicalId`, and every statement is
tenant-scoped. Exact shapes, valid against the one canonical DDL:

```ts
// POST /api/customers/cards/:canonicalId/notes — many notes per card allowed
await db.from('entity_note').insert({
  tenant_id: tenantId, entity_type: 'customer',
  entity_key: canonicalId,        // canonical_id::text — the stable key
  canonical_id: canonicalId, body, created_by: userId,
}).select('id, body, created_at').single();

// GET /api/customers/cards/:canonicalId  -> notes[]
await db.from('entity_note').select('id, body, created_at')
  .match({ tenant_id: tenantId, entity_type: 'customer', entity_key: canonicalId })
  .order('created_at', { ascending: false });

// DELETE /api/customers/notes/:noteId — never by id alone
await db.from('entity_note').delete()
  .match({ id: noteId, tenant_id: tenantId, entity_type: 'customer' });
```

`entity_type` and `entity_key` are **required** — an insert of
`(tenant_id, canonical_id, body)` alone violates two `NOT NULL`s. `canonical_id`
is nullable with `ON DELETE SET NULL` (not `CASCADE`): reads key on `entity_key`,
so an owner's note survives a canonical-record change, consistent with the
Rollback rule that owner-authored text is never destroyed.

**PCI/PII invariants enforced in code and asserted by tests:** no response body,
log line, error string, or `merge_candidate` payload ever contains `accNo`,
`card_holder_name`, `holder_fp`, or the salt. Note bodies are owner-authored
free text: never write a cardholder name into one on the owner's behalf.

### Client props

```ts
// apps/web/src/redesign/pages/Customers.tsx
interface CustomersPageProps { }                       // reads auth from context, like EdiInvoices.tsx
interface TopLineProps  { summary: CustomersSummary }  // renders the one sentence + the permanent caveat
interface CardRowProps  { card: CardListItem; onOpen: (id: string) => void }
interface CardDetailProps { canonicalId: string; onBack: () => void }
```

### Performance budget (named, per C5)

| Budget | Value | Precedent |
|---|---|---|
| Warehouse upstream timeout | **5,000 ms**, then fail-soft | `src/server.ts:4010` `AbortSignal.timeout(5000)` |
| Server response cache TTL | **60,000 ms** per `(tenantId, route, days)` | `src/server.ts:4007` `OWNER_DIGEST_TTL_MS` |
| `GET /api/customers/summary` p95, warm cache | **≤ 150 ms** | — |
| `GET /api/customers/cards` p95, warm cache, limit 50 | **≤ 400 ms** | — |
| Ingest run for a 90-day window | **≤ 60 s**, never blocks a request (202 + background) | — |
| Page interactive on 4G mobile | **≤ 2.5 s** | — |
| Horizontal page scroll at 320 / 768 / 1440 px | **zero**, both orientations | C5 |

---

## Implementation steps

Steps **1, 2 and 8 can run in parallel** — they touch disjoint files. **Step 3 is
founder-gated (Q13) and must not be started with them.** Step 4 needs 1+2; its
warehouse implementation additionally needs Q3. Step 5 needs 4. Steps 6–7 need
3+5 (so they inherit Q13), and Steps 6–9 are behind the journey gate (**Q15**)
with their copy behind Q8. Step 9 needs everything.

**Before starting:** create a worktree off `origin/main`.
`pwsh C:/Users/nirpa/Documents/Projects/shre-dev-kit/scripts/worktree.ps1 add aros h-customer-profile`
(or `git worktree add ~/.shre/worktrees/aros/h-customer-profile origin/main -b feat/customer-profile`).
Do **not** work in `C:/Users/nirpa/Documents/Projects/aros`.

### Step 1 — The functional core (no I/O at all)

New files, no edits to anything existing:

- `src/customers/normalize.ts` — `normalizeLast4`, `normalizeBrand`,
  `normalizeHolder`. `normalizeLast4` takes the **last 4 characters** and returns
  them only if all four are ASCII digits; every other input returns `null`.
- `src/customers/keys.ts` — the `CARD_KEY_COMPOSITION` constant above.
- `src/customers/fingerprint.ts` — `cardFingerprint(salt, storeScope, brand, last4)`
  and `holderFingerprint(salt, holder)`. **Salt is a parameter.** The only import
  permitted is `node:crypto`.
- `src/customers/confidence.ts` — `confidenceOf`.
- `src/customers/aggregate.ts` — `aggregateCards(rows, salt, storeScope)`:
  Map-reduce over `PaymentRow[]`, one pass, no I/O. Rows failing `normalizeLast4`
  or `normalizeBrand` increment `skipped` and are excluded from `distinctCards`
  but **counted in `paymentRowsTotal` and `rowsWithoutCard`** so the caveat is
  honest.

**Reviewer check:** `grep -rn "supabase\|fetch(\|process\.env\|node:fs" src/customers/*.ts`
returns **nothing** except `node:crypto` in `fingerprint.ts`.

### Step 2 — The migration(s)

**GATE — Q15, applies to `20260725_customer_profile.sql` only.**
`docs/journeys/see-who-comes-back.md` carries `STATUS: DRAFT — founder approval
required before any schema`, and `CLAUDE.md`'s journey gate requires the spec in
the same PR as the golden-path E2E. **Confirm approval with the orchestrator
before writing this file**, then land the spec on the working branch (copy from
`origin/docs/retail-profiles`). Do not create tables "provisionally".
**Exactly one file is outside this gate: `20260724_canonical_strong_key_rls.sql`.**
It creates no table and ships no journey — it is a security fix on already-merged
code, and both tracks carve it out for that reason. `20260724_entity_note.sql`
is **not** carved out: it creates a new table for a new capability, so it waits
on Q15 here and on the Item Profile track's Q3 there (whichever gate opens first
lets its owner, or this track, create it — byte-identically, once).

Add `supabase/migrations/20260725_customer_profile.sql` exactly as sketched in
[Data contract](#migration----supabasemigrations20260725_customer_profilesql).
Do **not** edit `20260720_golden_records.sql` — the `canonical_strong_key` fix is
an additive `ALTER` in a separate new file so history stays replayable.

**`public.canonical_strong_key` RLS + REVOKE first — and only once.** This track
does not own that DDL either; the Item Profile track does
(`g-item-profile-plugin.md` § "Shared migration —
`supabase/migrations/20260724_canonical_strong_key_rls.sql`"). It is a **security
fix, not a feature**, and it may land ahead of both tracks' founder gates.

1. `git fetch origin && ls supabase/migrations | grep canonical_strong_key`.
2. **If `20260724_canonical_strong_key_rls.sql` is present**, do nothing.
3. **If it is absent**, create that file with **exactly** the SQL in the Item
   Profile brief's shared-migration section — byte-for-byte, same filename. Do
   not fold it into this file, do not drop the `REVOKE`, do not rename it (the
   `20260724_c…` prefix is what makes it sort before `20260724_entity_note.sql`,
   `20260724_item_profile.sql` and this file).
4. Either way,
   `grep -rln "ALTER TABLE public.canonical_strong_key ENABLE ROW LEVEL SECURITY" supabase/migrations/ | wc -l`
   must print `1`. If it prints `2`, two files declare the same gate — **STOP**
   and reconcile to the owner's copy (Q14). `check-migration-safety.mjs` cannot
   catch this: verified at `scripts/check-migration-safety.mjs:24-25`, it reads
   every `*.sql` and `.join('\n')`s them into **one** string before matching, so
   a duplicated declaration is indistinguishable from a single one.

**`public.entity_note` first — and only once.** This track does not own that
table's DDL; the Item Profile track does
(`g-item-profile-plugin.md` § "Shared migration —
`supabase/migrations/20260724_entity_note.sql`").

1. `git fetch origin && ls supabase/migrations | grep entity_note`.
2. **If `20260724_entity_note.sql` is present**, do nothing — the table, its
   indexes, RLS, grant and trigger already ship with it.
3. **If it is absent** (the Item Profile track's founder gate is still closed),
   create that file with **exactly** the SQL in the Item Profile brief's shared
   migration section — copy it byte-for-byte, same filename. Do **not** author a
   variant, do **not** drop a column you think this track does not need
   (`entity_type` and `entity_key` are what make one table serve both), and do
   **not** move it into this file.
4. Either way, `grep -rln "CREATE TABLE IF NOT EXISTS public.entity_note" supabase/migrations/ | wc -l`
   must print `1`. If it prints `2`, the second one is a **silent no-op** and
   one track's inserts will fail at runtime — **STOP** and reconcile (Q11).

**Reviewer check:** `node scripts/check-migration-safety.mjs` exits 0 (verified
at `scripts/check-migration-safety.mjs:24-25`: it reads every migration and
`.join('\n')`s them into a single string before matching, so it will *not* catch
a duplicate `entity_note` or `canonical_strong_key` declaration — that is what
the two `grep` gates are for). It *will* fail if
`public.customer_card_holder_fp` is added without `ENABLE ROW LEVEL SECURITY`;
that is the only part of (2a) it can see. It cannot see a missing `REVOKE` on a
**table** (its REVOKE rule covers views only, `:49-58`), so the `REVOKE ALL …
FROM anon, authenticated` on the sidecar is reviewer-enforced and asserted by
T6b — do not drop it on the strength of a green lint.

### Step 3 — Resolver binding (D2) — **GATED on founder ratification (Q13)**

This is the only change in this package to **merged golden-record code**, and no
other track touches `src/golden/`. It is not a rebase chore — do not land it
before the founder has answered **Q13**. Everything else in steps 1–2 and 4–5
proceeds without it.

One line. `src/golden/resolve.ts:58` — **the `customer` line. Verified by opening
the file: `:55` is the `const STRONG_KEYS` declaration, `:56` is `product`,
`:57` is `location`, `:58` is `customer`, `:59` is the closing `};`. Match on the
snippet below, never on the line number alone — adding `card_fp` to `location`
is a silent wrong mutation of merged golden-record code:**

```diff
-  customer: ['phone_hash', 'email_hash'],
+  customer: ['phone_hash', 'email_hash', 'card_fp'],
```

Add a `src/__tests__/golden-resolve.test.ts` case proving that two ingests of the
same `card_fp` in the same tenant return the same `canonicalId` with outcome
`auto_linked` (or `alias_hit`), and that the same `card_fp` in a **different**
tenant returns a **different** `canonicalId`. Change nothing else in that file.

### Step 4 — The warehouse read adapter (one interface, one method)

`src/customers/source.ts` — the imperative shell's only inbound seam:

```ts
export interface PaymentSource {
  /** Payment rows for one store scope in [start,end). Never returns a PAN. */
  fetchPayments(i: { storeScope: string; start: string; end: string }):
    Promise<{ rows: PaymentRow[]; sourceMaxSyncedAt: string | null }>;
  /** Cheap presence probe for the activation gate. */
  probeCardIdentity(i: { storeScope: string }):
    Promise<{ cardRows: number; totalRows: number; sampleDays: number }>;
  /** Top items per invoice set, for the detail view. */
  fetchTopItems(i: { storeScope: string; invoiceNos: string[] }):
    Promise<Array<{ invoiceNo: string; itemCode: string; itemName: string | null; qty: number }>>;
}
```

Ship **one** implementation, `createWarehousePaymentSource()`, that proxies
`SHRE_RAPIDRMS_URL` exactly like `handleOwnerDigest` (`src/server.ts:4010`):
5 s `AbortSignal.timeout`, 60 s TTL cache, fail-soft. **This is the decision
gated by Q3.** Until the founder answers, implement the interface and a
`createFixturePaymentSource(rows)` for tests, and have
`createWarehousePaymentSource()` return `{ rows: [], sourceMaxSyncedAt: null }`
with `state: 'unreachable'` if `SHRE_RAPIDRMS_URL` has no customers endpoint —
**never** a fabricated row.

Do **not** open a new `pg` pool. Do **not** import
`connectors/rapidrms/analytics-connector.ts` (broken SQL + injection, ground
truth G).

### Step 5 — The ingest shell

`src/customers/ingest.ts`:

1. `resolveDigestScope(tenantId)` → `storeScope`; null ⇒ `state: 'no_connector'`.
2. Assert `AROS_ENCRYPTION_KEY` (503 refusal rule), derive `salt(tenantId)`.
3. Insert `customer_profile_run` with `status='running'` **and the actor stamp**:
   `triggered_by`. The ingest entry point takes it as an explicit argument —
   `runCustomerProfileIngest({ tenantId, triggeredBy }: { tenantId: string; triggeredBy: string | null })`
   — and writes `{ tenant_id: tenantId, triggered_by: triggeredBy, store_scope, … }`.
   `handleCustomersRefresh` (Step 6) passes the **server-resolved** acting user id
   from the authenticated session (the same `auth` object its
   `canManageMarketplace(auth.role)` check reads); a scheduled/system caller passes
   `null`. **Never read it from the request body** — a client-supplied actor is not
   an actor stamp. Do not make the parameter optional with a `null` default: an
   omitted argument and a genuine system run must not be indistinguishable at the
   call site.
4. `source.fetchPayments(...)` → `aggregateCards(rows, salt, storeScope)`.
5. Per aggregate: `resolveCanonical(createGoldenStore(), {...card_fp...})`,
   then upsert `customer_card_rollup` — **never include a `holder_fp` key in
   that upsert object; the column does not exist.** Write `agg.holderFps`
   instead to the service-role sidecar
   `customer_card_holder_fp` (`{ tenant_id, run_id, canonical_id, holder_fp }`,
   one row per distinct hash, `onConflict: 'run_id,canonical_id,holder_fp'`,
   ignore duplicates). When `agg.holderFps.length > 1`, call `flagCandidate`
   (no PII in the payload — the hashes stay in the sidecar).
6. `source.fetchTopItems` → `customer_card_top_item` (top 5 by qty).
7. Update the run to `status='complete'` with all counts +
   `source_max_synced_at`.

Every DB write uses `createSupabaseAdmin()` (service role), matching
`src/golden/store.ts:12`.

### Step 6 — Server handlers + routes

Edit `src/server.ts` only. Add near the EDI handlers (`src/server.ts:6096`):

- `const CUSTOMERS_APP_KEY = 'customers';`
- `handleCustomersSummary`, `handleCustomersCards`, `handleCustomersCardDetail`,
  `handleCustomersNoteCreate`, `handleCustomersNoteDelete`,
  `handleCustomersRefresh`, `handleMarketplaceReadiness`.
- Each of the `/api/customers/*` handlers opens with the **exact** three-line
  preamble from `src/server.ts:6096-6099`, substituting
  `'The Customers app is not installed for this workspace. Install it from the Marketplace to see who comes back.'`
- `handleCustomersRefresh` and the note write/delete additionally require
  `canManageMarketplace(auth.role)` (`src/server.ts:2607`) → 403 naming the role.
  **`handleCustomersRefresh` then passes the acting user id straight into the
  ingest** — `runCustomerProfileIngest({ tenantId, triggeredBy: auth.userId })`
  (Step 5.3) — so `customer_profile_run.triggered_by` records who asked. Same
  server-resolved `auth` object the role check above uses; never `body.userId`.
  `AuthContext.userId` is set by `authenticateRequest` (`src/server.ts:2557-2568`)
  and `created_by: auth.userId` is the established in-repo shape
  (`src/server.ts:2917`, `:2781` `enabled_by`). The activity-spine binding is what
  makes this mandatory, not the audit log.
- Register the routes in the dispatch chain immediately after the EDI block at
  `src/server.ts:6966`, same `if (pathname === ... && method === ...)` style.
- `handleMarketplaceReadiness` reads `platform_apps.readiness_check`; when it is
  `NULL` it returns `{ ready: true, check: null }`. The `'card-identity'` check
  calls `source.probeCardIdentity` over the last 14 days and returns `ready:true`
  iff `cardRows > 0`, `ready:false / no_card_detail` iff `totalRows > 0 && cardRows === 0`,
  and `ready:null / unreachable` on any timeout or error.

### Step 7 — Marketplace readiness UI (shared, declarative — not an if-app-is-customers branch)

- `apps/web/src/redesign/pages/connections/api.ts` — extend `PlatformApp` with
  `readiness_check?: string | null`; add
  `fetchReadiness(auth, appId): Promise<Readiness>`.
- `apps/web/src/redesign/pages/connections/MarketplacePage.tsx:65` — inside the
  existing dialog, when `selected.readiness_check` is a non-empty string: fetch
  on open, render *Checking your register…* → the returned `detail` string, and
  **disable the Activate button** unless `ready === true`. When `ready === null`
  render a **Check again** button. When `readiness_check` is null/absent the
  dialog behaves exactly as today. **No app id appears in this component.**
- Extract the check logic into a pure `readinessGate(readiness)` helper in a new
  `apps/web/src/redesign/pages/connections/readinessLogic.ts` and add it to the
  `vitest.config.ts` `include` list (it sits alongside
  `appsLogic.test.ts`, already listed at `vitest.config.ts:13`).

### Step 8 — Shell wiring for the `customers` section

**Nine** edits, all mechanical, mirroring `edi-invoices`. The last three were
missing from an earlier revision of this brief; without them `pnpm typecheck`
(T9) fails and `/customers` 404s for signed-out visitors.

| File:line | Change |
|---|---|
| `apps/web/src/redesign/shellData.ts:11` | add `\| 'customers'` to `SectionKey` |
| `apps/web/src/redesign/shellData.ts:37` | `Record<'documents' \| 'edi-invoices' \| 'customers', NavItem>`; add `customers: { key: 'customers', label: 'Customers', glyph: 'Cu' }` |
| `apps/web/src/redesign/shellData.ts:117` | **REQUIRED for typecheck** — `SECTIONS` is `Record<Exclude<SectionKey,'chat'>, SectionSpec>`. Add the **safe** form used by `marketplace`/`connectors`/`plugins` at `:127-129`: `customers: { eyebrow: 'Customers', lead: 'See which shoppers come back and how often.', rows: [] }` — **no `stats`, no `rows`**. Copying the `edi-invoices` entry at `:118-126` ships fabricated rows and is a C4 defect by construction |
| `apps/web/src/redesign/shellData.ts:284` | add `customers: 'Customers'` to `SECTION_TITLES` |
| `apps/web/src/redesign/routes.ts:13` | add `'/customers': 'customers',` to `PATH_TO_SECTION` |
| `apps/web/src/redesign/routes.ts:31` | add `customers: '/customers',` to `SECTION_TO_PATH` |
| `apps/web/src/redesign/AppShell.tsx:181` | extend the gate condition to `section === 'documents' \|\| section === 'edi-invoices' \|\| section === 'customers'`; add `if (section === 'customers') return <Customers />;` after the `installedApps.has(section)` check and **before** the `demo ? … : <EdiInvoices />` line at `:190` |
| `apps/web/src/app/App.tsx:40` | add `'/customers'` to `KNOWN_PREFIXES` — without it, signed-out visitors to `/customers` get a 404 (`App.tsx:170`) |
| `apps/web/src/app/App.tsx:43-52` | add `['/customers', 'Customers — AROS']` to `ROUTE_TITLES` |

Add `expect(routeState('/customers')).toEqual({ mode: 'app', section: 'customers' })`
to `apps/web/src/redesign/routes.test.ts` (already in `vitest.config.ts`'s
`include`) and run `npx vitest run apps/web/src/redesign/routes.test.ts`.

### Step 9 — The page

`apps/web/src/redesign/pages/Customers.tsx`, modelled on
`apps/web/src/redesign/pages/EdiInvoices.tsx` (554 lines) for data-fetch,
loading, error and empty conventions. **No `demo` prop and no demo-only branch:**
the page always calls `/api/customers/*` and renders what comes back. At
`/preview/app` there is no session, so it gets `401` and shows the honest
signed-out state — that is what makes a sample number structurally impossible,
and it is what the local Playwright run drives. Required elements:

- **The one sentence**, with the window and an `as of <time>` + **Check now**.
- **Permanently visible caveat**, verbatim: *"We don't know anyone's name. We
  recognize the card they pay with **at this store**. Cash customers aren't in
  here."* (the "at this store" clause is the C3 requirement).
- **Low-confidence handling** per Q6: `confidence: 'low'` rows show *"we're not
  sure this is one shopper"* and are excluded from the headline repeat count,
  which is stated: *"(1,572 cards had no name on them — they're counted
  separately.)"* Do **not** promise a review queue that does not exist.
- **Every failure state from the journey table**, each with the recovery action:
  403 naming the role · no connector → **Connect my store** · unreachable →
  **Check again** · no card detail → honest dead end · 0 card payments (with the
  real count) · <14 days → *"'Came back' numbers get real after a couple of
  weeks"* · connector disconnected → amber banner · card seen once → *"Seen once,
  on 12 July"* · note save failure preserves the text.
- **Never a zeroed dashboard, never a sample or plausible number.**
- Zero horizontal scroll at 320–1440 px. The two risky elements are the top-line
  sentence and the card row — use `overflow-wrap: anywhere` on the sentence and
  let the row wrap; do **not** put the row in a horizontal scroller.

---

## Acceptance tests

Run everything from the worktree root.

### T1 — Pure normalizer, all seven observed `acc_no` shapes

`src/__tests__/customers-normalize.test.ts`, run with
`npx vitest run src/__tests__/customers-normalize.test.ts`.

```ts
expect(normalizeLast4('12XXXXXXXXXX4412')).toBe('4412');  // DDXXXXXXXXXXDDDD, 11891 rows
expect(normalizeLast4('XXXXXXXXXXXX0071')).toBe('0071');  // XXXXXXXXXXXXDDDD, 125 rows
expect(normalizeLast4('4412')).toBe('4412');              // bare 4 digits,     1256 rows
expect(normalizeLast4('***')).toBeNull();                 // 3 non-digits,         5 rows
expect(normalizeLast4('')).toBeNull();                    // empty,             7218 rows
expect(normalizeLast4('XXXXXXXXX1234')).toBe('1234');     // length 13 straggler
expect(normalizeLast4('XXXXXXXXXXX123X')).toBeNull();     // length 15, non-digit tail
expect(normalizeLast4(null)).toBeNull();
expect(normalizeLast4('123')).toBeNull();                 // too short
// PCI: the output is exactly the last four characters — never longer, and the
// two leading BIN digits are dropped, not carried through.
// CORRECTED 2026-07-24 — this was `.not.toContain('12')`, which CANNOT PASS:
// the correct output '4412' contains the substring '12'. Assert the shape.
expect(normalizeLast4('12XXXXXXXXXX4412')).toHaveLength(4);
expect(normalizeLast4('12XXXXXXXXXX4412')).toBe('4412');
expect(normalizeLast4('12XXXXXXXXXX4412')!.startsWith('12')).toBe(false);
```

### T2 — Fingerprint determinism, tenant isolation, store isolation

`src/__tests__/customers-fingerprint.test.ts`, run with
`npx vitest run src/__tests__/customers-fingerprint.test.ts`.

`cardFingerprint` takes the salt as an argument (§Pure functions), so the test
defines its own — mirroring §Salt custody with a fixed test key. **Do not read
`process.env` in this test**; `src/customers/` must stay env-free.

```ts
import { createHmac } from 'node:crypto';
const TEST_KEY = 'test-key-not-a-secret-0123456789abcdef';   // ≥32 chars, never 'aros-dev'
const salt = (t: string) =>
  createHmac('sha256', TEST_KEY).update(`customer-card-fp:v1:${t}`).digest('hex');

const a = cardFingerprint(salt('t1'), 'client-2', 'VISA', '4412');
expect(cardFingerprint(salt('t1'), 'client-2', 'VISA', '4412')).toBe(a);        // stable
expect(cardFingerprint(salt('t2'), 'client-2', 'VISA', '4412')).not.toBe(a);    // C1 not portable
expect(cardFingerprint(salt('t1'), 'client-180727','VISA','4412')).not.toBe(a); // C3 per store
expect(a).toMatch(/^[0-9a-f]{64}$/);
expect(a).not.toContain('4412');                                                // no last4 leak
```

The last assertion is deterministic for a fixed `TEST_KEY`, but a 4-hex-char
substring has a ~0.09% chance of occurring in 64 hex chars. If it fires,
**change `TEST_KEY`, not the implementation** — a hit is a coincidence, not a leak.

### T3 — Aggregation over a fixture that reproduces the live shape

`src/__tests__/customers-aggregate.test.ts`, run with
`npx vitest run src/__tests__/customers-aggregate.test.ts`. Hand-built fixture asserting:
a card on 3 distinct invoices → `visits === 3`; two rows on the **same**
`invoiceNo` → `visits === 1`; a nameless card → `confidence === 'low'`; a card
with two distinct holder names → `holderFps.length === 2` (the merge signal);
`topLine.rowsWithoutCard` equals the count of rows the normalizer rejected;
`repeatPct` is computed from `repeatCards / distinctCards` and rounded once.

### T4 — Resolver binding

`npx vitest run src/__tests__/golden-resolve.test.ts` — the new cases from step 3
(same `card_fp` same tenant ⇒ same canonical; same `card_fp` different tenant ⇒
different canonical).

### T5 — PII / PCI leak assertions

`src/__tests__/customers-pii.test.ts`, run with
`npx vitest run src/__tests__/customers-pii.test.ts`: serialise the response shapes produced by
each handler's pure projection function over a fixture whose rows carry
`accNo: '12XXXXXXXXXX4412'` and `cardHolderName: 'RAMESH PATEL'`, then assert
`JSON.stringify(body)` contains **neither** `'RAMESH'`, `'PATEL'`, `'12XXXX'`,
`holder_fp`, nor the salt. Do the same for the `flagCandidate` payload and for
every `console.error` argument (spy on `console.error`).

**T5 is not sufficient on its own and never was.** It serialises *handler
projections*; it cannot see what a tenant member can select directly through
PostgREST. The database-level counterpart is **T6b**, which is the test that
actually proves `holder_fp` is unreachable. Both are required.

### T6 — RLS negative tests (cross-tenant read returns zero rows)

There is **no local Supabase config in this repo** (`supabase/` contains only
`catchup/` and `migrations/`) and **no existing RLS test precedent** — you are
creating it. **A bare `postgres:16` container will not work:** every policy in
the set calls `auth.uid()` and `entity_note.created_by` FKs `auth.users(id)`,
neither of which exists outside the Supabase stack. Stand it up with:

```
npx supabase init          # creates supabase/config.toml — do NOT commit it in this PR
npx supabase start         # prints the DB URL + anon / service_role keys
npx supabase db reset      # applies supabase/migrations in lexical order
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/customer_profile_rls_test.sql
```

**Wrap every role-switching block in `BEGIN; … ROLLBACK;`.** `SET LOCAL` outside
a transaction is a warning-and-no-op in psql, which would leave the script
running as the superuser — RLS bypassed, and the test reports a false result in
both directions. Structure each case as:

```sql
BEGIN;
  SET LOCAL ROLE authenticated;
  SET LOCAL request.jwt.claims = '{"sub":"<user-of-tenant-A>"}';
  -- assertions
ROLLBACK;
```

The script must, for each of `customer_profile_run`, `customer_card_rollup`,
`customer_card_top_item` and `entity_note` — the four **member-readable** tables:

**(`canonical_strong_key` and `customer_card_holder_fp` are deliberately NOT in
this list. Both are `REVOKE ALL`'d from `authenticated`, so a member's `SELECT`
must raise `insufficient_privilege`, not return zero rows — they are asserted in
**T6b** instead. If you put them here, a passing "count = 0" would mean the
REVOKE had been lost.)**

```sql
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"<user-of-tenant-A>"}';
-- must return 0 for every tenant-B row
SELECT count(*) FROM public.customer_card_rollup WHERE tenant_id = '<tenant-B>';
ROLLBACK;
```

and `RAISE EXCEPTION` if any count is non-zero. **If a database cannot be stood
up, STOP and report — do not skip this test.**

The `entity_note` seed rows must be inserted in **this track's own shape** —
`(tenant_id, entity_type => 'customer', entity_key => canonical_id::text,
canonical_id, body, created_by)` — so the test also proves this track's insert
is valid against the shared DDL it does not own. Add one row in the Item
Profile shape too (`entity_type => 'product'`, `entity_key => '<store>:<item>'`,
`canonical_id => NULL`) and assert a **second** `'customer'` note for the same
`entity_key` succeeds while a second `'product'` note for the same `entity_key`
is rejected by `uq_entity_note_product` — that is the one-note-per-item /
many-notes-per-card contract.

Also: `node scripts/check-migration-safety.mjs` must exit 0,
`grep -rln "CREATE TABLE IF NOT EXISTS public.entity_note" supabase/migrations/ | wc -l`
must print `1`, and
`grep -rln "ALTER TABLE public.canonical_strong_key ENABLE ROW LEVEL SECURITY" supabase/migrations/ | wc -l`
must print `1`.

### T6b — NEGATIVE privilege tests: the sensitive tables must ERROR, not filter

Same scratch database as T6. T6 proves *row* isolation (a member sees zero of
another tenant's rows). **T6b proves absence of privilege** — the failure mode a
policy cannot express and T5 cannot see. Every statement below must raise
`42501 insufficient_privilege`; a result set of **any** size, including zero
rows, is a **FAIL**. Same `BEGIN; … ROLLBACK;` rule as T6 — outside a
transaction `SET LOCAL ROLE` is a no-op and every statement below would
"succeed" as the superuser, which this test reports as a FAIL for the wrong
reason.

```sql
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"<user-of-tenant-A>"}';

-- (1) THE holder_fp TEST. Must ERROR: permission denied for table
--     customer_card_holder_fp. Zero rows returned is NOT a pass — it would mean
--     SELECT was granted and RLS merely filtered.
SELECT holder_fp FROM public.customer_card_holder_fp;                      -- expect ERROR
SELECT count(*)  FROM public.customer_card_holder_fp;                      -- expect ERROR
--     …including for the caller's OWN tenant, where a policy would have let it through:
SELECT holder_fp FROM public.customer_card_holder_fp WHERE tenant_id = '<tenant-A>';  -- expect ERROR

-- (2) The column must not have come back to the member-readable table.
SELECT holder_fp FROM public.customer_card_rollup;   -- expect ERROR 42703 undefined_column
--     Belt and braces, independent of the DDL:
SELECT count(*) FROM information_schema.columns
 WHERE table_schema='public' AND table_name='customer_card_rollup'
   AND column_name='holder_fp';                       -- expect 0

-- (3) canonical_strong_key: RLS + REVOKE both in force (finding 2).
SELECT key_value FROM public.canonical_strong_key;    -- expect ERROR
ROLLBACK;
```

Each statement above is written bare for readability; in the file **each one is
its own `DO` block** that fails when the statement *succeeds*. Use `PERFORM`, not
`SELECT` (a bare `SELECT` in PL/pgSQL is a syntax error), and catch the error the
statement actually raises — `insufficient_privilege` for (1) and (3),
**`undefined_column` for (2)**:

```sql
DO $$ BEGIN
  PERFORM holder_fp FROM public.customer_card_holder_fp;
  RAISE EXCEPTION 'FAIL: authenticated could SELECT customer_card_holder_fp';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;

DO $$ BEGIN
  PERFORM holder_fp FROM public.customer_card_rollup;
  RAISE EXCEPTION 'FAIL: holder_fp is back on customer_card_rollup';
EXCEPTION WHEN undefined_column THEN NULL; END $$;
```

Without the per-statement `DO` wrapper the first error aborts the transaction and
every later assertion reports `25P02 in_failed_sql_transaction` instead of its own
verdict. Run the file as `supabase/tests/customer_profile_privileges_test.sql`
alongside T6's, with the same `psql … -v ON_ERROR_STOP=1 -f` invocation.

Three more assertions in the same file, run as the table owner (a role that can
see the ACLs — `information_schema` views only show grants involving roles the
*current* user belongs to, which is why the catalog functions are used here
instead):

```sql
-- No privilege of any kind on the two service-role tables, for either
-- PostgREST role. All four must be FALSE.
SELECT has_table_privilege('authenticated','public.customer_card_holder_fp','SELECT'),
       has_table_privilege('anon',         'public.customer_card_holder_fp','SELECT'),
       has_table_privilege('authenticated','public.canonical_strong_key',   'SELECT'),
       has_table_privilege('anon',         'public.canonical_strong_key',   'SELECT');

-- The definitive ACL read: no anon/authenticated entry survives on either table.
SELECT count(*) FROM pg_class c
  JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a ON true
 WHERE c.relnamespace = 'public'::regnamespace
   AND c.relname IN ('customer_card_holder_fp','canonical_strong_key')
   AND a.grantee::regrole::text IN ('anon','authenticated');   -- expect 0

-- And the member-readable table still grants only what the loop intended —
-- in particular there is no COLUMN-level grant anywhere on it (a column grant
-- is the shape the deleted no-op REVOKE was pretending to produce).
SELECT count(*) FROM information_schema.column_privileges
 WHERE table_schema='public' AND table_name='customer_card_rollup'
   AND grantee IN ('anon');                                    -- expect 0
```

**If a database cannot be stood up, STOP and report — do not skip T6b.** This is
the only test in the suite that would have caught the no-op-REVOKE defect, and
shipping `holder_fp` without it repeats the exact failure.

### T7 — The kill-criterion re-check — **[FOUNDER/OPERATOR-EXECUTED]**

**Codex does not run this.** It needs a live Cortex credential this workspace
does not hold; the `pg` client is only present under
`C:/Users/nirpa/Documents/Projects/shreai/node_modules`, and the credential comes
from `readVaultJson()` in `shreai/scripts/vault-lib.mjs`. Codex's deliverable is
the SQL file `docs/missions/evidence/retail-profiles/phase3-kill-criteria.sql`
plus the pass thresholds below; the founder runs it read-only and pastes the
result back, and Codex writes it up alongside. **Never** run it against a
production warehouse on your own initiative, and never widen it to select a value
column.

Before rendering any number for a tenant, re-run all four checks from
[the kill criterion table](#kill-criterion--carried-forward-verbatim-and-its-measurable-test)
scoped to that tenant's `store_scope`. Aggregate/COUNT queries only — never
`SELECT acc_no` or `SELECT card_holder_name`:

```sql
-- (a) coverage; (b) repeat; (c) PCI shape; (d) basket join
SELECT count(*) FILTER (WHERE acc_no ~ '[0-9]{4}$' AND coalesce(card_type,'') <> '') AS card_rows,
       count(*) AS total_rows,
       count(*) FILTER (WHERE acc_no ~ '[0-9]{5}')  AS pan_risk_rows,   -- MUST be 0
       max(synced_at) AS source_max_synced_at
  FROM rapidrms.payment_transaction
 WHERE store_id = :store_scope AND invoice_date >= :start;
```

If `pan_risk_rows > 0`, **STOP immediately** and escalate — that is a PAN in the
warehouse and no code ships until it is removed upstream.

### T8 — Install-gate and auth integration

Start the server first — `pnpm serve` (`package.json:23`, `tsx src/server.ts`,
port 5457) with `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` pointed at T6's
scratch project. Then, with the app **not** installed for the tenant:
`curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOKEN" http://127.0.0.1:5457/api/customers/summary`
⇒ **409**. Unauthenticated ⇒ **401**. With `AROS_ENCRYPTION_KEY` unset ⇒ **503**.
A viewer-role token on `POST /api/customers/refresh` ⇒ **403**.

**T8b — the actor stamp is actually written (activity-spine binding).** Runnable
by an executor with no token, against T6's scratch database: call
`runCustomerProfileIngest({ tenantId, triggeredBy: '<a real auth.users id>' })`
with the fixture payment source, then
`select triggered_by from public.customer_profile_run order by started_at desc limit 1;`
⇒ **that exact uuid, not NULL**. Repeat with `triggeredBy: null` ⇒ **NULL**
(the scheduled-run case). A run row whose `triggered_by` is NULL after a
*user-triggered* refresh is the spine's stated failure signal — **fail the test,
do not relax it.** With a token, the same assertion end-to-end: `POST
/api/customers/refresh` as an owner ⇒ the newest run row carries that owner's id.

**Where `$TOKEN` comes from: the founder, out of a browser session they already have
open — or a user seeded in a scratch Supabase (T6's database).** Do **not** obtain one by
calling `POST /api/login`, and do **not** use `~/.shre/secrets/chat-eval.env`: that
credential returns 401 as of `2026-07-24T00:17:28Z` and `src/server.ts:1176-1189`
escalates a lockout on repeat failures against the founder's own production account.
The two cases that need no token at all — unauthenticated ⇒ 401, `AROS_ENCRYPTION_KEY`
unset ⇒ 503 — are runnable by an executor today and should be run first.

### T9 — Typecheck, lint, build

```
npx tsc -p tsconfig.json --noEmit     # <- the one that covers src/customers/*
pnpm typecheck && pnpm build
```

**`pnpm typecheck` does not cover this track's server code.** Verified: `turbo
typecheck` runs the task only in the three workspace packages that define it —
`apps/mcp-aros`, `apps/web`, `packages/pos-sdk` (`package.json` `typecheck`
scripts). Root `src/**` is checked only by the root `tsconfig.json`, which has no
`include` and excludes `node_modules`/`dist`/`apps/web`. So `pnpm typecheck`
**does** catch the Step 8 `SECTIONS`/`SECTION_TITLES` exhaustiveness failures
(those are in `apps/web`) and **does not** catch anything in `src/customers/`.
Run both commands.

**`pnpm lint` is a vacuous pass — do not cite it as a gate.** `lint` is declared
in `turbo.json:13` but **no package in this workspace defines a `lint` script**
(repo-wide grep over every non-`node_modules` `package.json` returns only the
root's `"lint": "turbo lint"`), so it executes nothing and exits 0.

### T10 — Live golden path — **[FOUNDER/OPERATOR-EXECUTED]**

Codex writes the spec and hands it over; it does **not** run this. It needs a
deploy to beta, a real sign-in, and an app activation on a real tenant — all
outside an executor's authority. Codex's local gate is `npx playwright test
e2e/customers-golden-path.spec.ts` in local mode (mocked `/api/*` at
`/preview/app`, `playwright.config.ts:19-26`), which proves the spec runs but not
that the flow works.

On the deployed beta surface, as the persona, with no seeded state and no API
shortcuts:

1. `node scripts/journey-walk.mjs --base <beta-url>` (seam level).
2. `E2E_BASE_URL=<beta-url> npx playwright test e2e/customers-golden-path.spec.ts`
   — a spec that drives
   `/marketplace?tab=apps` → **Customers** card → dialog shows the live check →
   Activate → **Customers** appears in nav → `/customers` renders the one
   sentence with a real count and an `as of` time → clicking a row opens a real
   card with a real visit count.
3. Zero horizontal scroll asserted at 320 / 768 / 1440 px:
   `await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)`
   at each viewport, portrait and landscape.
4. Then the `journey-walker` subagent for any step it marks NEEDS-BROWSER
   (required by `CLAUDE.md` §Journey gate in this repo).

---

## Non-goals

This track must **not** touch:

- **Anything REGULARS.** `src/public/customer-api.ts`, `apps/mcp-aros`,
  `public_products_v`, `public_promotions`, `regulars.aros.live`. No shared
  tables, routes, handler files, or naming.
- **Consumer identity, consent tiers, loyalty enrolment, marketing sends,
  names/emails/phones, cross-store or cross-merchant recognition.** All REGULARS
  (US Prov. 64/113,480). If a requirement drifts there, **escalate**.
- **`skills/` and `@aros/skills`.** Do not modify, extend, delete, or import
  `skills/src/skills/customer-profiler.ts`. Harvest verdict: **LEAVE**.
- **`connectors/rapidrms/analytics-connector.ts`.** Broken SQL + SQL injection.
  Do not import it, do not fix it here — file an issue instead.
- **The golden-record resolution algorithm.** The *only* permitted change to
  `src/golden/resolve.ts` is adding `'card_fp'` to `STRONG_KEYS.customer` at
  line 58. No new resolution path, no second identity table, no local
  card→customer map, no `customer_id` minted outside `canonical_entity`.
- **A merge/review workflow.** `negative_pair` suppression, merge execution, and
  un-merge are explicitly out (see Q6). `merge_candidate` rows are written and
  surfaced read-only as *"might be the same person"* with **no auto-merge and no
  resolve action** in this phase.
- **Phase 2 (Item Profile) analytics**, Phase 4 (register/exception alerts), the
  automation engine, `deal-hunter.ts`, and any POS write.
- **A new `pg` pool or new Postgres credentials in the aros server.**
- **Any migration edit to `20260720_golden_records.sql` or
  `20260721_golden_claim_fn.sql`.** Additive `ALTER` in the new migration only.

---

## Collision warnings

### Live co-edit hazard — the primary checkout is dirty on exactly these files

`C:/Users/nirpa/Documents/Projects/aros` is on branch `feat/chat-first-redesign`
with **61 dirty entries**, including uncommitted modifications to:

- `apps/web/src/redesign/pages/connections/MarketplacePage.tsx` ← step 7
- `apps/web/src/redesign/shellData.ts` ← step 8
- `apps/web/src/redesign/pages/connections/api.ts` ← step 7
- `connectors/rapidrms-api.ts`
- `connectors/types.ts`
- `src/server.ts` ← step 6

**Assume merge conflict.** Do all work in a fresh worktree off `origin/main`,
and immediately before opening the PR run
`git fetch origin && git rebase origin/main`, then re-read those six files. Never
run `git checkout`, `git switch`, `git stash`, `git reset`, or `git rebase` inside
the primary checkout.

### Shared with the Item Profile track (`g-item-profile-plugin`)

| Artefact | Rule |
|---|---|
| `public.entity_note` DDL | **CORRECTED — the earlier "identical text in both briefs" claim in this table was false.** The two briefs declared six materially different things (`entity_type`/`entity_key` present in G and absent here; `canonical_id` nullable+`SET NULL` there vs `NOT NULL`+`CASCADE` here; `length(body) <= 2000` vs `char_length(body) BETWEEN 1 AND 2000`; `created_by` FK only here; a table-wide `UNIQUE` only there). Because both used `CREATE TABLE IF NOT EXISTS`, the second migration would have been a **silent no-op** and the second track's inserts would have failed at **runtime**, not at apply time. **Resolution: one owner.** The Item Profile track owns the DDL in `supabase/migrations/20260724_entity_note.sql` (`g-item-profile-plugin.md` § Shared migration); this track declares no `entity_note` DDL and this brief's migration is renamed `20260725_customer_profile.sql` so the owner sorts first. Merge gate: `grep -rln "CREATE TABLE IF NOT EXISTS public.entity_note" supabase/migrations/ \| wc -l` must print `1`. See Step 2 and Q11. |
| `canonical_strong_key` RLS + REVOKE | **CORRECTED — this is no longer "safe in either order", and "idempotent" was the wrong thing to reason about.** Two tracks each carrying their own copy of the gate is the same one-declaration hazard as `entity_note`, and the sequencing was backwards: the Item Profile track's Step 5.1 writes a strong key for **every catalog row**, so its rows would have landed in an ungated table before this brief's migration ran. **Resolution: one owner, one file, sorts first.** The Item Profile track owns `supabase/migrations/20260724_canonical_strong_key_rls.sql` (its § Shared migration); it carries `ENABLE ROW LEVEL SECURITY` + the member-select policy **and** `REVOKE ALL ON public.canonical_strong_key FROM anon, authenticated;`; it sorts before `20260724_entity_note.sql`, `20260724_item_profile.sql` and this brief's `20260725_customer_profile.sql`; and it may land ahead of **both** tracks' founder gates because it is a security fix, not a feature. This brief declares none of it. Merge gate: `grep -rln "ALTER TABLE public.canonical_strong_key ENABLE ROW LEVEL SECURITY" supabase/migrations/ \| wc -l` must print `1`. See Step 2, ground truth B, and Q14. |
| `public.customer_card_holder_fp` | **This track's own table, not shared** — listed here so no one "tidies" it into a column on `customer_card_rollup` or into the golden-records RLS loop. Service-role only: RLS on, no policy, no grant, explicit `REVOKE ALL … FROM anon, authenticated`. See § The holder signal and T6b. |
| `src/golden/resolve.ts:55-59` `STRONG_KEYS` | **CORRECTED — this is not a two-way conflict, and framing it as one hid the real issue.** The Item Profile track touches **no file under `src/golden/`**: its Non-goals say *"`src/golden/*` — bind to it, do not extend or alter it,"* and its Decision 2 works entirely inside the existing `product: ['upc','gtin','sku']`. **This track is the only track in the package that mutates merged golden-record code** — Step 3 adds `'card_fp'` to `STRONG_KEYS.customer` (`:58` — the `customer` line; `:57` is `location`). There is nothing to rebase against; there is a gate to clear. **Founder ratification is required before Step 1** — the package-wide standing rule is "bind to the golden-record layer, never fork or extend it," and this is an extension of the resolver's identity rules on the merged layer, not a routine sequencing matter. See **Q13**. |
| `apps/web/src/redesign/shellData.ts`, `routes.ts`, `AppShell.tsx` | Both tracks add a section to the same three literal unions and maps. Same conflict class. **Land Item Profile first if it is ready, or land these two steps in a single combined PR.** |
| `platform_apps.readiness_check` column | Added by this track. If Item Profile also wants a probe, it reuses the column — `ADD COLUMN IF NOT EXISTS`. |

### Other

- `src/server.ts` is edited by nearly every AROS track. Add the new handlers as a
  **contiguous block** right after the EDI handlers and the routes as a
  contiguous block right after the EDI routes, so conflicts are localised.
- `docs/missions/retail-profiles.md` and `docs/journeys/see-who-comes-back.md`
  live on branch `origin/docs/retail-profiles`, **not on `main`**. Their D1
  numbers and coverage table are wrong (ground truth M/N). Do not "fix" them in
  this PR — raise the correction with the founder as part of Q1/Q2.

---

## Rollback

The feature is activation-gated and purely additive, so rollback has three
independent levers, cheapest first:

1. **Per tenant, instant, no deploy.** Disable the entitlement:
   `POST /api/marketplace/apps/customers/disable` (route
   `src/server.ts:7038-7040`, handler `handleMarketplaceDisable` at
   `src/server.ts:2820`), or set
   `marketplace_app_entitlements.status <> 'active'` for that tenant. Every
   `/api/customers/*` route immediately 409s (`hasActiveAppEntitlement` at
   `src/server.ts:2617`), the nav entry disappears
   (`AppShell.tsx:113-115`), and the section renders `<AppInstallPrompt>`
   (`AppShell.tsx:187`). No data is deleted.

2. **Fleet-wide, one SQL statement, no deploy.** Hide the app from the catalog:
   `UPDATE public.platform_apps SET status = 'planned' WHERE id = 'customers';`
   `handlePlatformApps` rejects activation for non-`active` apps
   (`src/server.ts:2995`: *"This app has not completed its launch and workspace
   SSO contract"*) and the Marketplace card renders as **Coming soon**.

3. **Code revert.** `git revert` the PR. The server and web changes are additive;
   the only edit to pre-existing behaviour is the one-line
   `STRONG_KEYS.customer` addition, whose removal simply stops `card_fp` from
   resolving (existing `phone_hash`/`email_hash` behaviour is untouched).

**Data rollback:**

```sql
-- Drop the derived tables (all rollup, no source of truth). The holder_fp
-- sidecar goes FIRST and is the one that actually matters in a PII rollback:
DROP TABLE IF EXISTS public.customer_card_holder_fp;
DROP TABLE IF EXISTS public.customer_card_top_item;
DROP TABLE IF EXISTS public.customer_card_rollup;
DROP TABLE IF EXISTS public.customer_profile_run;
-- Retire the canonical customer records this track created, reversibly:
UPDATE public.canonical_entity SET status = 'merged_away'
 WHERE entity_type = 'customer'
   AND id IN (SELECT canonical_id FROM public.canonical_strong_key WHERE key_type = 'card_fp');
DELETE FROM public.canonical_strong_key WHERE key_type = 'card_fp';
```

**Do NOT roll back** `supabase/migrations/20260724_canonical_strong_key_rls.sql`
(the RLS + `REVOKE`), and **never drop `public.entity_note`** — the first is a
security fix owned by another track that must survive any revert of this feature
(and reverting it would leave the Item Profile track's `upc`/`sku` rows ungated),
and the second is a shared table owned by the Item Profile
track that may hold that track's `entity_type='product'` rows. Both are additive
and harmless if the Customers app is gone. If this track's notes specifically
must go, delete only its own rows:
`DELETE FROM public.entity_note WHERE tenant_id = '<uuid>' AND entity_type = 'customer';`

**If a PCI or PII leak is the reason for rollback**, do lever 1 *and* the
`DELETE FROM public.canonical_strong_key WHERE key_type = 'card_fp'` + table
drops immediately, then notify the founder.

**Do NOT rotate `AROS_ENCRYPTION_KEY` — not as part of this rollback, not by an
executor, not at all without the founder's explicit go-ahead and a migration plan.**
That variable is not this track's salt key; it is the platform's connector-credential
key. `ensureConnectorCrypto()` (`src/server.ts:3682-3688`) derives the connector cipher
key as `sha256(AROS_ENCRYPTION_KEY)`, and every tenant's POS username/password lives in
`tenant_connectors.credentials_encrypted` sealed under it (`src/server.ts:132`, `:472`,
`:3728`, `:4130`). **Rotating it silently destroys every stored connector credential on
the platform — every tenant, every connector, unrecoverable without each customer
re-entering their POS password.** Deleting the fingerprints (above) already achieves
the leak containment this line was reaching for, because a `card_fp` is only
reconstructible from rows that no longer exist.

If a key rotation genuinely is required, it is a **founder-run, platform-wide
operation** with a documented re-encrypt-all-connectors step (decrypt with the old key,
re-encrypt with the new one, in one transaction, with a verified backup first) — a
separate incident runbook, never a bullet in a feature rollback.

**BLOCKING QUESTION for the founder:** should the customer-fingerprint salt keep deriving
from `AROS_ENCRYPTION_KEY` at all (Data contract §Salt custody)? *Recommendation:* no —
give it its own secret (`CUSTOMER_FP_SALT_KEY`, same startup refusal rules), so that
"burn the fingerprints" and "burn every connector credential" can never be the same
action. Until that is decided, the coupling stands and this rollback must not touch the
key.

---

## Stop conditions — open decisions, come back to the founder

Codex must **STOP and return to the founder** — not proceed on an assumption —
in each of these situations.

| # | Question / trigger | Why it stops the work |
|---|---|---|
| **Q1** | **Revised D1.** At full scale the cardholder name **splits** `brand+last4` into 17.9% more identities (4,851 → 5,719) rather than resolving ~2% of collisions. Recommended rule: strong key = `sha256(salt \| storeScope \| brand \| last4)`; a name mismatch within a key creates a `merge_candidate`; a name absence marks the card LOW CONFIDENCE. **Confirm before any number is shown to a tenant.** | It contradicts a written founder decision. The schema is composition-agnostic, so steps 1–5 proceed; shipping a headline number does not. |
| **Q2** | **C3 store scoping.** 234 `brand+last4` identities already transact at more than one `store_id`. Confirm that Customer Profile counts strictly per `resolveDigestScope` store scope, that the UI says **"at this store"**, and that any cross-store rollup is escalated to REGULARS rather than built here. | Cross-store recognition is patented REGULARS territory (US Prov. 64/113,480). The journey lists this as "founder decision pending"; the data now forces it. |
| **Q3** | **Read path.** Proxy Cortex through the `shre-rapidrms` warehouse API (mirroring `handleOwnerDigest`, `SHRE_RAPIDRMS_URL` `:5443`) — recommended — or add a first-class server-side `pg` reader on `shre_router_ro`? Grants for the direct route already exist (`has_table_privilege` true on `rapidrms.payment_transaction`, `rapidrms_analytics.card_activity_log`, `rapidrms_analytics.rfm_segmentation`); **credential custody for it does not.** | Option (a) needs a companion change in `Nirlabinc/shreai`, outside this repo of record. Option (b) needs credential custody this repo does not have. Either way it is not a decision Codex may make alone. |
| **Q4** | **Salt custody.** Proposal: `salt = HMAC-SHA256(AROS_ENCRYPTION_KEY, 'customer-card-fp:v1:' \|\| tenant_id)`, key injected by the deploy secret store, hard startup refusal when missing or equal to `'aros-dev'`, with a documented migration to shre-secrets (`:5473`) per the TODO at `src/server.ts:3674`. **STOP if the answer is "use the vault"** — there is no vault client in this repo (`connectors/vault-ref.ts:17` is an in-process `Map`; `platform_apps.vault_namespace` is read by no code). | C1 says "vault-held". Writing code that pretends to fetch from a vault would be a lie in the security-critical path. |
| **Q5** | **Is `rapidrms.payment_transaction` a supported contract or an accident?** Not in aros `origin/main`; its only repo artefact is an untracked, drifted migration in a dirty checkout; no trigger populates it in prod. Who owns the writer (`shre-rapidrms`?), what is the refresh cadence, can the column list be pinned? **Under C4 no number ships until this is answered.** | Rendering a figure from an unpinned upstream is exactly the "number without a verified data contract" C4 forbids. |
| **Q6** | **Does the minimal merge-review surface land in Phase 3, or is it deferred?** 1,572 of 4,851 identities (32%) have no cardholder name and would be flagged LOW CONFIDENCE into a `merge_candidate` queue **that nothing reads** (`merge_candidate` is write-only today; `negative_pair` suppression is explicitly unwired at `src/golden/resolve.ts:51`). If deferred, confirm the founder accepts *"counted, marked uncertain, not queued"* and confirm the on-screen wording. | The journey's "Yes, same / No, different — remembered forever" step is unimplementable this phase. Shipping a queue with no reader is a defect. |
| **Q7** | **The headline wording.** Over the 99-day window 2026-04-15..2026-07-23 the sourced figures are 13,288 card payments, 4,851 distinct cards, 2,160 (44.5%) seen more than once. Confirm the sentence states the window, says cash customers are excluded, and confirm whether the top line uses **all** cards (4,851 / 2,160) or only the **named** subset (4,147 identities, 1,465 repeat). | Two defensible headlines with materially different numbers. Picking one silently is a C4 violation. |
| **Q8** | **Naming.** The mission and journey say "Customer Profile" / "Customers", but the data supports only *cards*, and the journey's own failure state relabels to *"returning cards"*. C3 makes "Customer" the REGULARS word. The mission's own open question is *"Which name should the owner see?"* **Resolve before any UI copy is written.** | Renaming after copy, routes (`/customers`), the `platform_apps.id`, and the nav key are shipped is a migration, not an edit. |
| **Q9** | **Legal/privacy sign-off** for storing a card fingerprint + purchase history. The journey lists this as a **hard deploy gate** mirroring `TERMS_GATE_ENABLED`. The gate machinery exists (`src/terms/gate.ts`, `src/terms/constants.ts:21`) but **no sign-off record was found either way**. | Deploying to a real tenant without it is a stated failure condition of the mission. |
| **Q10** | **Any kill-criterion check fails for a tenant** (T7): coverage < 25%, repeat < 15%, `pan_risk_rows > 0`, or basket join < 90%. | Verbatim: *"Phase 0 finds no usable payment identifier → Phase 3 stops for a founder decision (do not substitute a guess)."* A `pan_risk_rows > 0` result is an immediate security escalation. |
| **Q11** | **RESOLVED — no longer a founder question, but still a merge gate.** The `entity_note` DDL is now owned by exactly one brief (Item Profile, `supabase/migrations/20260724_entity_note.sql`) and this track declares none. **STOP only if** `grep -rln "CREATE TABLE IF NOT EXISTS public.entity_note" supabase/migrations/` returns more than one file, **or** the file on `origin/main` differs from the Item Profile brief's § Shared migration text. | Two `CREATE TABLE IF NOT EXISTS` declarations for one shared table make the second a silent no-op — the failure then surfaces as a runtime insert error in production, not as a failed migration. |
| **Q12** | **`rapidrms_analytics.rfm_segmentation` is proposed as a shortcut.** It is already keyed on `card_last4 + card_network + card_holder` with RFM, segment, tier and recommended_action — but **it was not verified to partition by store** (row counts and key columns read; `pg_get_viewdef` not run). | An unpartitioned view is a C3 cross-store identity leak. Run `pg_get_viewdef` and get founder sign-off before binding to it. |
| **Q13** | **Founder ratification of the `STRONG_KEYS.customer` change (blocking, before Step 1).** Step 3 adds `'card_fp'` to `STRONG_KEYS.customer` in `src/golden/resolve.ts:58` (the `customer` line — `:57` is `location`) — **merged golden-record code that no other track in this package touches.** The standing rule is *bind to the golden layer, do not fork or extend it*, and this extends the resolver's identity rules for every future `customer` resolution, not just this app's. Ask explicitly: *may Customer Profile add `card_fp` as a customer strong key on the merged golden layer?* **Recommendation: yes, but ratified and scoped** — it is one append to a declarative array, additive (removing it only stops `card_fp` resolving; `phone_hash`/`email_hash` are untouched), it is the only way to bind rather than fork a second identity path, and `card_fp` is already tenant-salted and per-store. Ship it together with the `golden-resolve.test.ts` case in Step 3 proving same-`card_fp`-same-tenant → same `canonicalId` and same-`card_fp`-different-tenant → different `canonicalId`, and with Q1's fingerprint composition settled first (the key's *composition* is what the founder is really ratifying). **Do not proceed on the assumption that "it's a one-line diff, so it's routine."** | A unilateral edit to the merged golden layer is the one change class the package treats as a stop condition. It was previously mis-filed in this brief's collision table as a *mutual* textual conflict with the Item Profile track — a conflict that does not exist — which would have let it merge as a rebase chore with no ratification at all. |
| **Q14** | **RESOLVED — not a founder question, but a merge gate and a design rule that must not be undone.** (a) `canonical_strong_key`'s RLS + `REVOKE ALL` is owned by exactly one file, `supabase/migrations/20260724_canonical_strong_key_rls.sql` (Item Profile track), and this brief declares none of it. **STOP if** `grep -rln "ALTER TABLE public.canonical_strong_key ENABLE ROW LEVEL SECURITY" supabase/migrations/` returns more than one file, or the file on `origin/main` differs from the owner brief's text, or that file is absent when this track's Step 5 first writes a `card_fp`. (a2) **One founder confirmation is carried in the owner brief, not here** — `g-item-profile-plugin.md` Q4 asks whether `20260724_canonical_strong_key_rls.sql` may be raised as a standalone PR while that track's journey spec is still DRAFT (recommendation: yes — it creates no table and ships no journey). If the founder says **no**, this brief's Step 2 changes: the fix must be carried inline by whichever feature migration lands first, and the one-declaration grep gate becomes mandatory rather than belt-and-braces. Do not adopt that fallback silently. (b) `holder_fp` lives **only** in `public.customer_card_holder_fp` (service-role only). **STOP if** a reviewer asks to move it back onto `customer_card_rollup` "and just revoke the column" — that is the exact documented PostgreSQL no-op this design removes; the correct answer is the sidecar, or at minimum an explicit `GRANT SELECT (…column list…)` with **no** table-level grant anywhere, proven by T6b. | Both are the same class of defect: a protection that reads as present in the SQL and is absent in the database. The first would put production strong keys in an ungated table; the second put a stable hashed-cardholder-name identity token in front of every tenant member, with a test suite that could not see it. |
| **Q15** | **The journey spec is still DRAFT (blocking, before Step 2's own migration).** `docs/journeys/see-who-comes-back.md` carries `STATUS: DRAFT — founder approval required before any schema` — verified with `git show origin/docs/retail-profiles:docs/journeys/see-who-comes-back.md`, and that branch is never merged to `main`. Confirm approval with the orchestrator, then land the spec on the working branch so the PR carries it. **Scope of the gate:** it holds `20260725_customer_profile.sql` and Steps 6–9; it does **not** hold Step 1, `20260724_canonical_strong_key_rls.sql` or `20260724_entity_note.sql`. **Recommendation: ask for approval and Q8 (the name) in the same message** — the spec says "Customers" throughout and Q8 may change it, so approving the spec without settling Q8 buys nothing. | `CLAUDE.md` §Journey gate: no new user-facing capability starts as code, and a PR that adds a journey merges only with the spec plus a golden-path E2E. The Item Profile track carries the identical gate as its Q3; this brief had none, which would have let a zero-context executor create card-fingerprint tables against an unapproved spec. |
