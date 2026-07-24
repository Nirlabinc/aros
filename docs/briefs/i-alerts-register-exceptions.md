# Build brief — `i-alerts-register-exceptions`

> **Register/terminal identity on automation alerts + the voids chat answer (aros#168).**
> Executor: Codex, assumed zero context on this repo.
> All `path:line` anchors below were opened by hand in the aros worktree at
> **commit `9b4a693a4f088d40a6399f5649c9e03f9924a125`** (`origin/main`, 2026-07-23).
> If a line has moved, search for the quoted snippet — the snippet is the anchor,
> the number is a convenience.

---

## Track

Make the shipped void alert name **which register/terminal** the void happened on, and
make the AROS chat actually answer "any voids?" instead of erroring (aros#168).

User-visible outcome, in the owner's words:

- Before: *"Voided transaction at Calhoun FMT: $42.75, 2026-07-22T19:50:15, invoice 1282365."*
- After: *"Voided transaction at Calhoun FMT (POS1): $42.75, 2026-07-22T19:50:15, invoice 1282365."*
- Before, in chat: *"I'm unable to access the data required to check for voids or suspicious
  transactions. Please try again later or contact an administrator for assistance."*
- After, in chat: a real void count/amount for the period, plus an explicit
  statement of what the POS does **not** expose (refunds, no-sales, per-cashier
  attribution) instead of zeros.

The three other Phase-4 candidates from the retail-profiles contract — **cancelled
transaction, price change, manual discount** — are **DEFERRED with cause** (§ Non-goals).
The live warehouse probe proves the source fields do not exist. Building them would
require inventing a data contract, which the house rules forbid.

---

## Verified ground truth

### A. Field-availability verdict (probed live, read-only, 2026-07-23)

Probe method (re-runnable): decrypt `C:/Users/nirpa/.shre/vault/cortexdb.json` via
`readVaultJson` from `C:/Users/nirpa/Documents/Projects/shreai/scripts/vault-lib.mjs`
(key at `C:/Users/nirpa/.shre/.vault-key`), connect with `pg` from
`C:/Users/nirpa/Documents/Projects/shreai/node_modules/pg`, using
`{host, port, database: cfg.db, user, password, ssl:{rejectUnauthorized:false}}`.
Connected as `current_user = aros_cortex`, `current_database = postgres`.
**SELECT only. Zero writes were issued and none may be.**

Baseline: `rapidrms.invoice_report` = **20,980 rows**, invoice_date
`2026-04-15 20:04:25+00` .. `2026-07-23 20:18:15+00`.

| Field | Verdict | Evidence |
|---|---|---|
| **Register / terminal identity** | **AVAILABLE** | `raw_data ? 'registerId'` → **1,043 / 1,043** of api-payload rows; `registerName` likewise 1,043/1,043. Column `invoice_report.register_id` non-null 20,834/20,980 (99.3%). `invoice_line_item`: 36,687 rows, `register_id` non-null on all. |
| **Cancelled transaction** | **NOT AVAILABLE** | `invoice_report.status` distinct set is exactly `{COMPLETED: 19,935, NULL: 1,045}` — no cancel state. `raw_data->>'isVoid'` distinct set = `{'false'}` (1,043 rows, zero `true`). Nearest signal is line-level: `invoiceItemLog` `operation='Remove'` / `fieldName='Item'` = 77 entries — an item removed mid-sale, **not** a cancelled sale. |
| **Price change (at the register)** | **NOT AVAILABLE** | Complete distinct `(fieldName, operation)` set of `invoiceItemLog`: `PackageType/Item RingUp` 1,649, `Barcode/Item RingUp` 1,649, `DOB/User select YES option` 743, `QtyChange/Change` 189, `PumpId/Gas Item RingUp` 128, `PackageType/Gas Item RingUp` 128, `Barcode/Gas Item RingUp` 128, `Item/Remove` 77, `PackageType|Barcode|PumpId / Gas Item Refund` 37 each, `CustomerSelection/Add` 24, `DOB/User select NO option` 3, `DOB/User enter DOB` 3. **There is no `Price` fieldName.** `operation='Change'` pairs only with `QtyChange`. |
| **Manual discount** | **PARTIAL** | "A discount was applied" is real. The manual-vs-promotional discriminator is structurally present but empirically flat: every `itemDiscountDetail` entry in the warehouse is the same tuple — `discountType='Percentage', discountCategory='1', discountSubCategory='1'`, **206 / 206 entries, one distinct row**. There is no evidence manual and promotional discounts are distinguishable. |

Exact payload key set of the current `/api/InvoiceReport` row shape (all 1,043/1,043 populated,
verified via `jsonb_object_keys`):

```
age, billAmount, branchId, createdDate, custId, customerEmail, customerLoyaltyNo,
custRefID, datetime, deliverType, discountAmount, dob, employeeNo, holdInvoiceMemo,
invoiceItemDetail, invoiceItemLog, invoiceNo, invoicePaymentDetail, isVoid, noOfGuest,
orderNo, orderType, originalRegInvNo, registerId, registerInvNo, registerName, remarks,
shiftId, subTotal, surchargeAmount, tableNo, taxAmount, totalRows, userId, userName, zId
```

A real sampled row (redacted only for length):

```
invoiceNo 1282365 | registerId "2" | registerName "POS1" | isVoid "false"
shiftId "0" | userName "calhounfmt@gmail.com" | employeeNo "7063315789"
datetime "2026-07-22T19:50:15"
```

`registerId`/`registerName` are **top-level keys on the very same row that carries
`isVoid`** — the flag the sentinel already reads. That is the decisive fact: register
identity requires **no new endpoint, no new connector, no BOS scrape**. The sentinel
already receives it and throws it away.

Register-name / register-id observed pairs (why the name alone is not a key):

| registerName | registerId | rows |
|---|---|---|
| POS1 | 2 | 654 |
| POS1 | **43** | 281 |
| Out-Side Pay | -1 | 42 |
| POS2 | 1 | 42 |
| POS 2 | 41 | 24 |

**`POS1` maps to two different registers in two different stores.** Never key, group,
or dedupe on the name. The name is a display label only.

Second trap: the **column** `invoice_report.register_id` is NULL on **25 rows whose
payload carries `registerId = '-1'`** (Out-Side Pay / pump terminals) — the exact
terminal an owner most wants exception alerts on. This track reads the **payload
field**, not the column, so it is unaffected; recorded here so nobody "improves" it
onto the column later.

### B. Code the track binds to (all opened at `9b4a693`)

The automation engine is **already shipped end-to-end** (slices 1a + 1b). Do **not**
build a second engine.

- `connectors/data-service.ts:82` — `isVoided(row)`:
  ```ts
  function isVoided(row: Record<string, unknown>): boolean {
    const v = row.isVoid ?? row.IsVoid ?? row.is_void;
    return v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true';
  }
  ```
- `connectors/data-service.ts:100-115` — the `*_FIELDS` candidate-name constants
  (`REVENUE_FIELDS`, `SALES_DATE_FIELDS`, `INVOICE_NUMBER_FIELDS`, …). New field
  lists go here, in the same style.
- `connectors/data-service.ts:506` — `interface StoreInvoice { invoiceNo, recordId, businessDate, timestamp, amount, isVoid }`.
  **No register field.** This is the struct the sentinel consumes.
- `connectors/data-service.ts:650-680` — `collectInvoices()`, the pure row→`StoreInvoice`
  mapper. Lines 658-670 are the object literal that must gain the register fields.
- `connectors/data-service.ts:756` — `fetchStoreInvoices()`, the sentinel's only POS read.
- `connectors/data-service.ts:401-402`:
  ```ts
  export const EXCEPTION_SUPPORTED_TYPES = ['void'] as const;
  export const EXCEPTION_UNSUPPORTED_TYPES = ['refund', 'no_sale', 'cashier'] as const;
  ```
  **UNVERIFIED / contradicted-in-part:** `cashier_name` is populated 20,978/20,980 in
  Cortex and `userName`/`employeeNo` are 1,043/1,043 in the payload, so "cashier
  attribution is not available" is at best imprecise. **Do not change these constants
  in this track** — what `userName` identifies (the ringing cashier vs the logged-in
  terminal user) is unverified, and a wrong attribution on an exception alert is worse
  than an honest omission. See § Stop conditions.
- `connectors/data-service.ts:452` — `fetchExceptionSummary()`; `:419` `computeVoidExceptions()`
  (pure). These already exist and are already honest.
- `connectors/data-service.ts:595-648` — `collectItemChanges()`, incl. mode
  `recent_price_changes`, gated on `PRICE_CHANGED_FIELDS` (`:114`). Its honesty branch
  at `:637` returns `available:false` + a note rather than guessing.
  **UNVERIFIED:** none of the `PRICE_CHANGED_FIELDS` candidates was observed in any
  live payload; this path has never been exercised against real RapidRMS output.
  Verifying it needs a live `GET /api/Item` response captured from a connected tenant.
- `src/automation/rules.ts:20` — `AUTOMATION_CATALOG_EVENT = { transaction_voided: 'void-alert' }`.
  Doubles as the v1 trigger whitelist (`sanitizeConfirmedRule` at `:276` rejects
  anything not a key here). This is the independent-gating seam for future triggers.
- `src/automation/rules.ts:85` — `TRIGGER_LABELS = { transaction_voided: 'a transaction is voided' }`.
- `src/automation/rules.ts:461-468` — `interface InvoiceLike`; `:470-476` `interface VoidCandidateInvoice`.
- `src/automation/rules.ts:488` — `fireDedupeKey(tenantId, invoiceNo)` → `` `${tenantId}|${invoiceNo}` ``.
- `src/automation/rules.ts:524-539` — `newVoidsForRule()`, the pure void-diff.
- `src/automation/rules.ts:602-614` — `voidAlertMessage()`:
  ```ts
  const amount = typeof invoice.amount === 'number' && Number.isFinite(invoice.amount)
    ? `$${invoice.amount.toFixed(2)}`
    : 'an unlisted amount';
  const when = invoice.timestamp || invoice.businessDate || 'just now';
  return {
    subject: `Voided transaction at ${storeName}`,
    text: `Voided transaction at ${storeName}: ${amount}, ${when}, invoice ${invoice.invoiceNo}.`,
  };
  ```
  Copy this honesty precedent: it refuses to print `$0.00` for a missing amount.
- `src/notifications.ts:28` — `NOTIFICATION_CATALOG` opens here; the `void-alert` entry
  (`defaultEnabled: false`) is at `:64`.
- `src/notifications.ts:10-25` — `NOTIFICATION_CHANNELS`; **`sms` has `status: 'pending-provider'`.**
  **UNVERIFIED:** whether Twilio is actually configured on the prod box. Verifying it
  means reading `/opt/aros-platform/.env` on the VPS — an operator step, not Codex's.
- `src/server.ts:307-317` — `type SentinelRule`; `:319` `AUTOMATION_SENTINEL_COLUMNS`.
- `src/server.ts:368` — `runAutomationSentinel()`; kill switch at `:369`
  (`if (process.env.AUTOMATION_RULES === '0') return;`), in-flight guard at `:371`.
- `src/server.ts:477-479` — the exact place register identity is dropped today:
  ```ts
  const report = await fetchStoreInvoices(record, vaultSecretFor(tenantId), from, today, 500);
  const invoices: InvoiceLike[] = (report?.invoices ?? []).map((i) => ({ invoiceNo: i.invoiceNo, recordId: i.recordId, businessDate: i.businessDate, timestamp: i.timestamp, amount: i.amount, isVoid: i.isVoid }));
  if (!invoices.some((i) => i.isVoid)) return;
  ```
- `src/server.ts:570-572` — the delivery call:
  ```ts
  const msg = voidAlertMessage(storeLabel, c.invoice);
  await notifyWorkspace(tenantId, 'void-alert', msg.subject, msg.text,
    () => voidAlertContent({ storeName: storeLabel, ...c.invoice }, AROS_BRAND));
  ```
- `src/server.ts:635-641` — `notifyWorkspace(tenantId, event, subject, text, content?)`;
  fans out to every active `tenant_members` row whose `notification_preferences` enable
  that event on that channel.
- `src/server.ts:4768-4773` — `type ChatStoreIntent` (5 kinds today).
- `src/server.ts:4808-4836` — `storeChatIntent()`, an ordered regex ladder over the
  latest user message. Order matters; first match wins.
- `src/server.ts:4844-4928` — `handleArosStoreDataChat()`, the branch-per-intent shell.
- `src/server.ts:4225-4230` — `isArosSalesChat()`; already excludes `exception|void`:
  ```ts
  !/\b(inventory|stock|item|items|invoice|invoices|edi|exception|void|refund)\b/.test(text)
  ```
- `src/server.ts:5021-5101` — `handleStoreExceptions()`, the working HTTP handler;
  route registered at `:7012` (`GET /api/store/exceptions`).
- `src/server.ts:6783-6791` — the `/v1/chat` direct-intent chain:
  ```ts
  if (await handleArosHealthPing(req, res, body)) return;
  if (await handleArosAutomationChat(req, res, body)) return;
  if (await handleArosStoreDataChat(req, res, body)) return;
  if (await handleArosSalesChat(req, res, body)) return;
  return proxyRequest(req, res, SHRE_ROUTER_URL, body);
  ```
  **There is no voids/exceptions intent**, so "any voids?" falls through to the router
  LLM, which has no such tool → aros#168.
  **As-of 2026-07-24 this snippet is the state of `origin/main` only.** Three sibling
  tracks rewrite this block before or after you (C → D → I → A): C routes all four
  handlers through `arosChatJson`, D inserts a fifth handler line, A wraps every line in
  a capture shim. Re-read the block before editing; do not treat the five lines above as
  the shape you will find.
- `src/server.ts:4494` — the hard-coded honesty refusal for scheduled shift/tender
  reports. **Leave it alone in this track** (see § Non-goals).
- `src/email-templates.ts:785-816` — `VoidAlertFacts` + `voidAlertContent()`. Note it
  already has an **unused optional** `cashier?: string | null` rendering a `Cashier`
  key-value row at `:802`. Nothing populates it today.
- `supabase/migrations/20260722_event_subscriptions.sql:10` — `event_subscriptions`;
  `trigger_type` is **free text, no enum**; `status CHECK (active|pending_connector|suspended|disabled)`;
  partial unique `(tenant_id, fingerprint) WHERE status != 'disabled'`; RLS enabled with
  a member-SELECT policy; all writes service-role.
- `supabase/migrations/20260723_automation_fires.sql:31` — `UNIQUE (tenant_id, invoice_no)`,
  the at-most-once send authority. RLS enabled, **no policies, no grants** (service-role only).
- `docs/rapidrms-endpoint-discovery.md:12` — `| Victor | Void exceptions | GET /api/InvoiceReport isVoid flag | Verified live |`
  — the only exception row marked verified. Rows below record 404s for tender, hourly,
  tax, fuel, promotion, giftcard, and drop endpoints.
- aros#168 — **OPEN**, labels `chat-eval`, `chat-eval:tool-error`, title
  *"chat-eval: tool-error on \"voids\""*, fingerprint `chat-eval/voids/tool-error`
  (verified via `gh issue view 168 --repo Nirlabinc/aros`).

### C. The headline risk — state it in the PR description

**`isVoid` is `'false'` on 100% of rows ever synced (1,043/1,043; distinct value set
`{'false'}`; zero `true`).** Therefore `src/server.ts:479`
(`if (!invoices.some(i => i.isVoid)) return;`) returns on **every production pass**.
The shipped void alert has **never had a real event to fire on**. Slice A improves an
unexercised path. That is still worth doing (it is cheap, pure, and unit-testable), but
the brief and the PR must not claim the void alert is proven end-to-end.

**UNVERIFIED, and only the founder can resolve it:** whether voiding is disabled at
these stores, whether the POS deletes voided invoices instead of flagging them, or
whether `/api/InvoiceReport` filters them server-side. One founder action closes it:
void one test transaction at a known register, then re-run the probe.

### D. Things that could not be verified from here

- **Live `/api/InvoiceReport` HTTP response shape.** A direct API probe requires an
  authenticated login and an account-lockout risk is live (track E) — logins are
  forbidden. Every API-payload claim above is inferred from the **verbatim payload
  persisted into Cortex `raw_data`**, which carries the identical key set including the
  `isVoid` flag AROS already reads. Treat register identity as **CONFIRMED-BY-PROXY**
  until the first sentinel pass logs a real payload key set.
- **Whether `registerId`/`registerName` appear on voided rows specifically.** There are
  zero voided rows, so co-occurrence with `isVoid=true` is unobservable. Mitigation is
  built into the design: every register field is nullable and the message degrades to
  today's exact text when it is absent.
- **Semantics of `originalRegInvNo`** (13 populated rows) — plausibly a post-void/return
  pointer. 13 rows is not a contract; do not use it.
- **`rapidrms.shift_report` has 31 real rows** (`register_id` 29/31, `total_sales` 29/31,
  `cashier_name` **0/31**) arriving via some non-AROS pipeline. Which pipeline writes it
  is unknown. Tender breakdown is genuinely empty, so the Phase-2 shift/tender gate
  holds — but for a narrower reason than "no data exists".
- **Two `raw_data` shapes.** 19,935 rows are an older derived backfill
  (`{derived, bill_total, line_total}`); only 1,043 are the verbatim API payload.
  Any warehouse query written as if `raw_data` always carries the payload reads ~5% of
  the table. The payload shape is the **current** one (invoice dates 07-21..07-23), so
  it is go-forward correct and historically blind. This affects future warehouse
  analysis, not this track (AROS reads the HTTP API at runtime, not Cortex).
- **The seeded mission doc is not on `origin/main`.** `git show origin/main:docs/missions/aros-automation-rules.md`
  **fails**; `docs/missions/` on main contains only `aros-onboarding-store-flow-20260721.md`.
  The automation mission exists solely as an uncommitted working-tree file at
  `C:/Users/nirpa/Documents/Projects/aros/docs/missions/aros-automation-rules.md`
  in the primary checkout. Code comments across `rules.ts` and both migrations already
  cite that path as if it were durable. **Do not read the primary checkout's working
  tree and do not cite that path as a ref** — see § Stop conditions.

---

## Depends on / blocks

**Depends on — CORRECTED 2026-07-24.** Slice **A** depends on nothing and is
self-contained on `origin/main` at `9b4a693`.

Slice **B is NOT self-contained.** It adds a branch to `handleArosStoreDataChat`,
one of the four deterministic AROS chat handlers, and **four tracks in this package
rewrite that region.** Declared merge order for the `/v1/chat` dispatch block and
its handlers: **`c-honest-data-contract` → `d-actionable-errors` → this track →
`a-conversation-persistence`** (C → D → I → A). Slice B is **third** and takes one
hard input from C: **`arosChatJson()` plus `Provenance`/`classifyZero`/`describeZero`**,
because the exceptions reply prints a count and a dollar amount and must carry a
source and an `asOf` like every other figure-bearing AROS reply. See the sequencing
note at the top of step B2, and §Collision warnings → Package file-ownership register.
Slice A remains independent of all of it and can land at any time.

**Soft dependency (documentation only):** the retail-profiles contract this track derives
from is **PR #202 — `docs: retail profiles mission + journey specs`, branch
`docs/retail-profiles`, state OPEN**, adding `docs/missions/retail-profiles.md`,
`docs/journeys/see-who-comes-back.md`, `docs/journeys/should-i-reorder-this.md`. It is
docs-only and touches no file this track touches. No sequencing needed.

**Blocks:** any future track that adds a **second automation trigger type**. That track
cannot ship until the `automation_fires` unique key is widened (§ Data contract, "Deferred
migration"). Whoever picks it up starts from the deferral reasons in § Non-goals — those
verdicts are evidence-backed and must be re-probed, not re-argued.

~~I could not see other tracks' slugs from this worktree, so no other slug is named here.~~
**SUPERSEDED 2026-07-24 — the sibling briefs are now visible in `docs/briefs/` and are
named throughout.** Tracks A, B, C and D all edit `src/server.ts`; C and D and A edit the
same `/v1/chat` region Slice B does. Read § Collision warnings → Package file-ownership
register **before** starting Slice B.

---

## Data contract

### Slice A — register identity (no DB change)

**`StoreInvoice`** — `connectors/data-service.ts:506`. Two new **required-nullable** fields
(the mapper always sets them, so `null` means "the POS row did not carry it", never
"we forgot"):

```ts
export interface StoreInvoice {
  invoiceNo: string | null;
  recordId: string | null;
  businessDate: string | null;
  timestamp: string | null;
  amount: number | null;
  isVoid: boolean;
  /** POS terminal id as the payload spells it, e.g. "2", "43", "-1". Never a number:
   *  "-1" (Out-Side Pay / pump) is a real terminal and must survive verbatim. */
  registerId: string | null;
  /** Display label only, e.g. "POS1". NOT unique across stores — "POS1" is register 2
   *  in one store and register 43 in another. Never key or group on this. */
  registerName: string | null;
}
```

**`InvoiceLike`** (`src/automation/rules.ts:461`) and **`VoidCandidateInvoice`** (`:470`) —
add the same two fields but **optional** (`registerId?: string | null`), so every existing
construction site (including the `inv()` fixture at
`src/__tests__/automation-sentinel.test.ts:29`) keeps compiling unchanged.

**`VoidAlertFacts`** (`src/email-templates.ts:785`) — one new optional field:

```ts
export interface VoidAlertFacts {
  storeName: string;
  invoiceNo: string;
  amount: number | null;
  timestamp: string | null;
  businessDate: string | null;
  cashier?: string | null;      // pre-existing, still unpopulated — leave it alone
  register?: string | null;     // NEW: the rendered label, already resolved by registerLabel()
}
```

**Wire format:** `GET /api/store/invoices` (existing route, backed by `fetchStoreInvoices`)
gains `registerId` and `registerName` on each invoice object. Additive and nullable —
no client is required to read them. No client props change in this track.

**DB:** **none.** Register identity is delivered in the message and recorded in the
existing `auditLog(... detail: {...})` jsonb at `src/server.ts:587`. Do **not** add a
column to `automation_fires` for it — a migration on the send-path ledger is not worth
an observability nicety.

### Slice B — voids chat intent (no DB change)

New intent variant on `ChatStoreIntent` (`src/server.ts:4768`):

```ts
| { kind: 'exceptions'; from: string; to: string }
```

Response is the existing `/v1/chat` envelope — same shape every other branch of
`handleArosStoreDataChat` returns (`src/server.ts:4915-4918`):

```ts
{
  content: string,                    // markdown, the lines below
  _shre: {
    model: 'aros-store-data',
    toolsUsed: ['mib_exception_summary'],
    mode: 'aros-store-data-direct',
    tenantId: string,
    source: 'RapidRMS API'
  }
}
```

The reply text is produced by a **pure** renderer (§ Implementation step B2) from the
existing `ExceptionSummaryReport` (`connectors/data-service.ts:406-416`):

```ts
{
  totals: { void: { count: number; amount: number } },
  daily: Array<{ businessDate: string; count: number; amount: number }>,
  supportedTypes: string[],       // ['void']
  unsupportedTypes: string[],     // ['refund','no_sale','cashier']
  partial: boolean,
  source: { type: string; name: string },
  fetchedAt: string
}
```

### Deferred migration — DO NOT WRITE IT IN THIS TRACK

Recorded so the next track does not rediscover it. `automation_fires` is keyed
`UNIQUE (tenant_id, invoice_no)` (`supabase/migrations/20260723_automation_fires.sql:31`).
The moment a **second** trigger type exists, a void and (say) a discount on the same
invoice collide: the first claims the row, the second is silently swallowed —
a silent-suppression defect, not a visible failure. The fix, when that track comes:

```sql
-- supabase/migrations/<date>_automation_fires_trigger_type.sql
-- Widen the at-most-once claim key so exception TYPES are independent per invoice.
-- Required BEFORE any second automation trigger ships. Backfill first, then swap the
-- constraint, so no window exists where the ledger has no unique key.
ALTER TABLE public.automation_fires
  ADD COLUMN IF NOT EXISTS trigger_type text NOT NULL DEFAULT 'transaction_voided';

ALTER TABLE public.automation_fires DROP CONSTRAINT IF EXISTS automation_fires_tenant_id_invoice_no_key;

CREATE UNIQUE INDEX IF NOT EXISTS automation_fires_tenant_invoice_trigger
  ON public.automation_fires (tenant_id, invoice_no, trigger_type);

-- RLS posture is UNCHANGED and must be restated in the same migration so the
-- migration-safety lint (scripts/check-migration-safety.mjs) sees it: RLS on, NO
-- policies, NO grants to authenticated/anon. This is an internal delivery ledger;
-- only the platform service role claims or reads fires. A cross-tenant read is
-- impossible because no non-service role can select from it at all.
ALTER TABLE public.automation_fires ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.automation_fires FROM anon, authenticated;
```

and, in the same change, `fireDedupeKey` (`src/automation/rules.ts:488`) becomes
`(tenantId, invoiceNo, triggerType)` with `automationFireClaim` and the
`onConflict` string at `src/server.ts:553` updated to match. Shipping a new trigger
without all four of those is a defect.

---

## Implementation steps

Slice A (steps A1-A6) and Slice B (steps B1-B4) are **independent** and may be done in
parallel or as two PRs. Within a slice, the order is mandatory. Both slices touch
`src/server.ts` — see § Collision warnings before committing.

### Slice A — register/terminal identity on the void alert

**A1. `connectors/data-service.ts` — field lists + a pure extractor.**
Immediately after `PRICE_CHANGED_FIELDS`/`COST_CHANGED_FIELDS` (`:114-115`), add, in the
same style as the constants above them:

```ts
/** Live-verified 2026-07-23: the /api/InvoiceReport row carries registerId +
 *  registerName as TOP-LEVEL keys, on the same row as isVoid (1,043/1,043 rows in
 *  the Cortex-persisted verbatim payload). Casing variants are defensive only. */
const REGISTER_ID_FIELDS = ['registerId', 'RegisterId', 'register_id', 'RegisterID', 'terminalId', 'TerminalId'];
const REGISTER_NAME_FIELDS = ['registerName', 'RegisterName', 'register_name', 'terminalName', 'TerminalName'];
```

Then a pure, **exported** extractor (exported so it is unit-testable without I/O):

```ts
/** PURE. Register identity as the payload spells it. registerId stays a STRING:
 *  "-1" (Out-Side Pay / pump terminal) is a real register and must survive verbatim —
 *  the warehouse column drops exactly those rows to NULL, which is the bug we avoid
 *  by reading the payload field. Absent ⇒ null, never a guess. */
export function pickRegisterIdentity(row: Record<string, unknown>): { registerId: string | null; registerName: string | null } {
  return { registerId: pickStr(row, REGISTER_ID_FIELDS), registerName: pickStr(row, REGISTER_NAME_FIELDS) };
}
```

`pickStr` already exists at `:73` and already trims + rejects empty strings. Note it only
accepts `string` values; if a tenant ever returns `registerId` as a JSON number this
returns `null` (honest miss, never a wrong number). Live data has it as a string.

**A2. `connectors/data-service.ts` — widen `StoreInvoice` + the mapper.**
Add the two fields to `interface StoreInvoice` (`:506`) exactly as in § Data contract, then
in `collectInvoices` (`:658-670`) spread the extractor into the returned literal:

```ts
const invoices = rows.map((row) => {
  const trueInvoiceNo = pickStr(row, INVOICE_NUMBER_FIELDS);
  const recordId = pickStr(row, INVOICE_FIELDS);
  const timestamp = normalizeDateTime(pickDateString(row, SALES_DATE_FIELDS));
  const businessDate = pickBusinessDate(row) || (from === to ? from : null);
  return {
    invoiceNo: trueInvoiceNo,
    recordId,
    businessDate,
    timestamp,
    amount: pickNum(row, REVENUE_FIELDS),
    isVoid: isVoided(row),
    ...pickRegisterIdentity(row),      // ← only change
  };
})
```

No other function in this file changes. `fetchStoreInvoices` (`:756`) needs no edit — it
returns whatever `collectInvoices` produces.

**A3. `src/automation/rules.ts` — the pure label + message (this is the core of the slice).**
Add the two optional fields to `InvoiceLike` (`:461`) and `VoidCandidateInvoice` (`:470`),
carry them through `newVoidsForRule`'s push at `:536`, and add above `voidAlertMessage`:

```ts
/** PURE: the owner-facing terminal label, or null when the POS row did not say.
 *  Name wins when present (that is what the owner has written on the terminal).
 *  A bare id is only rendered when it is a plain non-negative integer — "register -1"
 *  is the pump/outside-pay sentinel and means nothing to an owner, so it degrades to
 *  null rather than printing a number no one can act on. Names are NOT unique across
 *  stores ("POS1" is register 2 in one store and 43 in another), which is safe here
 *  ONLY because the alert always states the store first. Never use this as a key. */
export function registerLabel(inv: { registerName?: string | null; registerId?: string | null }): string | null {
  const name = inv.registerName?.trim();
  if (name) return name;
  const id = inv.registerId?.trim();
  if (id && /^\d+$/.test(id)) return `register ${id}`;
  return null;
}
```

Then `voidAlertMessage` (`:602`) gains the register **only when known**:

```ts
export function voidAlertMessage(
  storeName: string,
  invoice: { invoiceNo: string; amount: number | null; timestamp: string | null; businessDate: string | null; registerId?: string | null; registerName?: string | null },
): { subject: string; text: string } {
  const amount = /* unchanged */;
  const when = invoice.timestamp || invoice.businessDate || 'just now';
  const register = registerLabel(invoice);
  const where = register ? `${storeName} (${register})` : storeName;
  return {
    subject: `Voided transaction at ${storeName}`,
    text: `Voided transaction at ${where}: ${amount}, ${when}, invoice ${invoice.invoiceNo}.`,
  };
}
```

**Hard requirement:** when `register` is null the text must be **byte-identical** to
today's. The subject stays store-only — mail clients truncate, and the store is the
useful disambiguator there. The existing assertions at
`src/__tests__/automation-sentinel.test.ts:226-238` must pass **unmodified**; if you find
yourself editing them, the change is wrong.

**A4. `src/email-templates.ts` — the email body.**
Add `register?: string | null` to `VoidAlertFacts` (`:785`), and inside `voidAlertContent`
(`:794`) push a row **only when present**, immediately after the `Store` row so the
key-value block reads Store → Register → Invoice → Time:

```ts
const rows: KeyValueRow[] = [{ label: 'Store', value: facts.storeName }];
if (facts.register) rows.push({ label: 'Register', value: facts.register });
rows.push({ label: 'Invoice', value: facts.invoiceNo, mono: true });
rows.push({ label: 'Time', value: when, mono: true });
if (facts.cashier) rows.push({ label: 'Cashier', value: facts.cashier });
```

Leave `preheader`, `title`, `eyebrow`, and the metric row unchanged — the preheader is
inbox-width-constrained and the store name already anchors it. Do **not** populate
`cashier`; nothing verified feeds it.

**A5. `src/server.ts` — the two shell edits (keep them minimal; this file is hot).**
- `:478` — carry the fields through the map:
  ```ts
  const invoices: InvoiceLike[] = (report?.invoices ?? []).map((i) => ({ invoiceNo: i.invoiceNo, recordId: i.recordId, businessDate: i.businessDate, timestamp: i.timestamp, amount: i.amount, isVoid: i.isVoid, registerId: i.registerId, registerName: i.registerName }));
  ```
- `:500` — the local `Candidate` type's `invoice` member gains the two optional fields,
  and `:507` carries them from the `VoidCandidateInvoice`.
- `:570-572` — pass the resolved label to the email builder. **The literal substring
  `() => voidAlertContent(` must remain** — `src/__tests__/email-templates.test.ts:562`
  asserts on it:
  ```ts
  const msg = voidAlertMessage(storeLabel, c.invoice);
  await notifyWorkspace(tenantId, 'void-alert', msg.subject, msg.text,
    () => voidAlertContent({ storeName: storeLabel, ...c.invoice, register: registerLabel(c.invoice) }, AROS_BRAND));
  ```
  Import `registerLabel` from `./automation/rules.js` alongside the existing imports at
  `src/server.ts:43-72`.
- `:587` — add register to the audit detail so a fire is traceable to a terminal without
  a schema change:
  ```ts
  detail: { rule_id: c.rule.id, channel: c.channel, destination: c.destination, amount: c.invoice.amount, register_id: c.invoice.registerId ?? null, register_name: c.invoice.registerName ?? null, fire_id: claimId }
  ```

**A6. Tests** — § Acceptance tests, A-block. Write them before opening the PR.

### Slice B — the voids chat intent (aros#168)

**B1. New pure module `src/chat/exception-intent.ts`.**
A new file keeps the functional core out of the 7,214-line `src/server.ts` and keeps this
slice's footprint there to three lines. It must import nothing but types.

```ts
/**
 * Voids / exceptions chat intent — PURE (no I/O, no clock, no DB).
 * Backs the /v1/chat direct intent that answers "any voids?" from the same
 * data /api/store/exceptions already serves (aros#168: the data and the HTTP
 * route existed; only the chat intent was missing, so the question fell through
 * to the router LLM, which has no such tool, and came back as a tool-error).
 */

/** True when the operator is asking about voided / suspicious transactions.
 *  Deliberately does NOT match the word "invoice" alone — that belongs to the
 *  existing invoices intent. */
export function isExceptionsQuestion(text: string): boolean {
  const t = text.toLowerCase();
  if (/\b(voids?|voided)\b/.test(t)) return true;
  if (/\bexceptions?\b/.test(t)) return true;
  if (/\bsuspicious\b/.test(t) && /\b(transactions?|activity|sales?)\b/.test(t)) return true;
  return false;
}

export interface ExceptionSummaryLike {
  totals: { void: { count: number; amount: number } } | null;
  daily: Array<{ businessDate: string; count: number; amount: number }>;
  supportedTypes: string[];
  unsupportedTypes: string[];
  partial: boolean;
}

const UNSUPPORTED_LABEL: Record<string, string> = {
  refund: 'refunds',
  no_sale: 'no-sale (drawer-open) events',
  cashier: 'per-cashier attribution',
};

/**
 * PURE renderer for the chat answer. Honesty rules, all load-bearing:
 *  - zero voids is a REAL answer ("no voided transactions"), never an error;
 *  - unsupported exception types are NAMED, never reported as zero;
 *  - the store name is always printed. The chat-eval scorer fails any reply
 *    containing the literal phrase "the store" (scripts/chat-eval/core.mjs:16)
 *    and any reply containing "unable to retrieve" / "try again later" /
 *    "contact an administrator" (core.mjs:4-13). Never emit those strings.
 */
export function exceptionSummaryLines(storeName: string, from: string, to: string, report: ExceptionSummaryLike | null): string[] {
  const range = from === to ? from : `${from} to ${to}`;
  if (!report) return [`**${storeName}** — no verified exception feed is available for this store.`];
  const count = report.totals?.void.count ?? 0;
  const lines = [`**${storeName} — voided transactions (${range})**`];
  if (count === 0) {
    lines.push(`- No voided transactions were recorded in this period.`);
  } else {
    lines.push(`- ${count} void${count === 1 ? '' : 's'}, $${report.totals!.void.amount.toFixed(2)} total.`);
    for (const day of report.daily) {
      lines.push(`  - ${day.businessDate}: ${day.count} void${day.count === 1 ? '' : 's'}, $${day.amount.toFixed(2)}`);
    }
    if (report.partial) lines.push('- One or more voids carried no amount, so the dollar total is a lower bound; the count is exact.');
  }
  const missing = report.unsupportedTypes.map((t) => UNSUPPORTED_LABEL[t] ?? t.replace(/_/g, ' '));
  if (missing.length) {
    lines.push(`- Your POS does not expose ${missing.join(', ')}, so I am not reporting numbers for those.`);
  }
  return lines;
}
```

**B2. `src/server.ts` — register the intent (three edits, all small).**

> **SEQUENCING — RESOLVED 2026-07-24. This brief was written package-blind ("I
> could not see other tracks' slugs from this worktree"); it can see them now.**
> The `/v1/chat` dispatch block and the four deterministic handlers are rewritten
> by **four** tracks. Declared merge order: **`c-honest-data-contract` →
> `d-actionable-errors` → `i-alerts-register-exceptions` (this track) →
> `a-conversation-persistence`** (C → D → I → A). You are **third**.
>
> **What that means for the new `exceptions` branch below — this is not optional:**
> track C lands first and introduces `arosChatJson(res, content, shre, p?)` as the
> **single reply choke point** for the deterministic AROS handlers. C's review
> criterion is literally *"`grep -n "json(res, 200" src/server.ts` shows no direct
> call inside lines ~4200-4930"*. Your branch prints **a void count and a dollar
> amount** — the exact class of output the package's "no number without a verified
> data contract" rule exists for. So:
> 1. Emit through **`arosChatJson`**, never a bare `json(res, 200, …)`.
> 2. Pass a **`Provenance`** built from the exception report (`fetchedAt`/`source`
>    per store, plus the connector row's `status`/`last_error`/`last_tested`), so
>    the reply carries a source and an `asOf` like every other figure-bearing AROS
>    reply. A count of voids with no `asOf` is exactly the honesty defect track C
>    exists to close.
> 3. Route the **zero case** through C's `classifyZero`/`describeZero` rather than
>    printing "No voided transactions were recorded in this period." unconditionally
>    — a genuine zero and an unreachable connector must not read the same. (B3 below
>    is right that a genuine zero is the correct answer; it just has to be *typed* as
>    a genuine zero.)
>
> Track **D** lands before you and inserts a fifth handler line
> (`handleArosConnectorHealthChat`) into the dispatch chain — it does not touch
> `handleArosStoreDataChat`, so it does not collide with your branch, but the line
> numbers below **will** have moved. Track **A** lands after you and wraps the whole
> chain in a capture shim — also no collision, same caveat about line numbers.
> **Anchor every edit on a function name (`grep -n "function handleArosStoreDataChat"`),
> never on `:4844`.** Full table: §Collision warnings → Package file-ownership register.
- `:4768-4773` — add `| { kind: 'exceptions'; from: string; to: string }` to `ChatStoreIntent`.
- `:4808-4836` — inside `storeChatIntent`, add the check **immediately before the
  `invoices` branch at `:4819`**, so "show me void invoices" routes to exceptions rather
  than the plain invoice list:
  ```ts
  if (isExceptionsQuestion(text)) return { kind: 'exceptions', ...chatDateRange(text) };
  ```
  Import `isExceptionsQuestion` and `exceptionSummaryLines` from `./chat/exception-intent.js`.
  Sanity check on ordering: the two branches above it are the timecard ones, whose regexes
  require a `time stamp|timecard|clock in|punch|payroll` token — "any voids?" cannot match
  them. Note the FIRST timecard branch matches `void` **only in combination with** a
  timecard token (`src/server.ts:4813`), so it is unaffected.
- `:4844-4913` — add a branch in `handleArosStoreDataChat`'s per-connector loop, alongside
  the existing `top_items` / `item_changes` / `invoices` branches:
  ```ts
  } else if (intent.kind === 'exceptions') {
    const report = await fetchExceptionSummary(record, vaultSecretFor(tenantId), intent.from, intent.to);
    toolsUsed.push('mib_exception_summary');
    lines.push(...exceptionSummaryLines(row.name, intent.from, intent.to, report));
  } else if (intent.kind === 'invoices') {
  ```
  `fetchExceptionSummary` is already imported at `src/server.ts:714`. Nothing else changes:
  the surrounding `try`/`catch`, the audit trail, and the response envelope are shared.
- `chatDateRange` (`:4781`) defaults to today-only. For an exceptions question that is
  usually too narrow to be useful; **default this intent to a 7-day window** by passing
  through `chatDateRange` only when the text carries an explicit period, else
  `{ from: nyBusinessDate(6), to: nyBusinessDate() }`. Keep that decision inside
  `storeChatIntent` (the shell) — `chatDateRange` is shared with other intents and must
  not change behaviour for them.

**B3. Verify the failure mode is gone.** The reply for a store with zero voids will be
*"No voided transactions were recorded in this period."* That is the **correct** answer
given § C — and it is exactly the "no number without a verified data contract" behaviour
the house rules want. Say so in the PR body so a reviewer does not read it as a stub.
**With track C landed (B2 sequencing note), that sentence must be produced by
`describeZero(classifyZero(...))` and carry a provenance footer**, so "genuinely zero
voids" and "the connector never answered" cannot render identically. Same words for a
`genuine_zero`; different, honest words for every other rung.

**B4. Tests** — § Acceptance tests, B-block.

---

## Acceptance tests

Run everything from the repo root of the aros worktree you are working in.
Vitest is configured at `vitest.config.ts` to pick up `src/**/__tests__/**/*.test.ts`.

### A-block — Slice A

**A-T1. Register extraction (pure), in `src/__tests__/store-risk-exception-data.test.ts`.**
Add to the existing `collectInvoices` describe block. Fixtures use the **live-verified**
field names and values from § A:

```ts
it('carries register identity from the live payload shape', () => {
  const [inv] = collectInvoices([
    { invoiceNo: '1282365', datetime: '2026-07-22T19:50:15', billAmount: 12.5, isVoid: false, registerId: '2', registerName: 'POS1' },
  ], '2026-07-22', '2026-07-22');
  expect(inv.registerId).toBe('2');
  expect(inv.registerName).toBe('POS1');
});

it('preserves the "-1" Out-Side Pay terminal verbatim (the warehouse column drops it to NULL)', () => {
  const [inv] = collectInvoices([
    { invoiceNo: '1282400', datetime: '2026-07-22T20:00:00', billAmount: 40, isVoid: false, registerId: '-1', registerName: 'Out-Side Pay' },
  ], '2026-07-22', '2026-07-22');
  expect(inv.registerId).toBe('-1');
  expect(inv.registerName).toBe('Out-Side Pay');
});

it('is null — never a guess — when the row carries no register', () => {
  const [inv] = collectInvoices([
    { invoiceNo: 'X', datetime: '2026-07-22T20:00:00', billAmount: 1, isVoid: false },
  ], '2026-07-22', '2026-07-22');
  expect(inv.registerId).toBeNull();
  expect(inv.registerName).toBeNull();
});
```

`npx vitest run src/__tests__/store-risk-exception-data.test.ts`

**A-T2. `registerLabel` + `voidAlertMessage` (pure), in `src/__tests__/automation-sentinel.test.ts`.**

```ts
describe('registerLabel (display only, never a key)', () => {
  it('prefers the name the owner sees on the terminal', () => {
    expect(registerLabel({ registerName: 'POS1', registerId: '2' })).toBe('POS1');
  });
  it('falls back to a plain numeric id', () => {
    expect(registerLabel({ registerName: null, registerId: '43' })).toBe('register 43');
  });
  it('refuses to print the -1 sentinel as a register number', () => {
    expect(registerLabel({ registerName: null, registerId: '-1' })).toBeNull();
  });
  it('is null when the POS said nothing', () => {
    expect(registerLabel({})).toBeNull();
  });
});

describe('voidAlertMessage register identity', () => {
  it('names the register when known', () => {
    const msg = voidAlertMessage('Main St Store', { invoiceNo: 'INV-9', amount: 42.75, timestamp: '2026-07-22T13:00:00Z', businessDate: '2026-07-22', registerName: 'POS1', registerId: '2' });
    expect(msg.text).toContain('Main St Store (POS1)');
    expect(msg.subject).toBe('Voided transaction at Main St Store'); // subject stays store-only
  });
  it('REGRESSION: byte-identical to the pre-register text when the register is unknown', () => {
    const msg = voidAlertMessage('Main St Store', { invoiceNo: 'INV-9', amount: 42.75, timestamp: '2026-07-22T13:00:00Z', businessDate: '2026-07-22' });
    expect(msg.text).toBe('Voided transaction at Main St Store: $42.75, 2026-07-22T13:00:00Z, invoice INV-9.');
  });
});
```

Also add one carry-through case to the existing `newVoidsForRule` describe:
`newVoidsForRule([inv({ registerName: 'POS1', registerId: '2' })], base)[0].registerName === 'POS1'`.

`npx vitest run src/__tests__/automation-sentinel.test.ts`

**A-T3. Email body, in `src/__tests__/email-templates.test.ts`.**
Assert `voidAlertContent({...facts, register: 'POS1'}, AROS_BRAND)` yields a `keyValue`
block containing `{ label: 'Register', value: 'POS1' }`, and that omitting `register`
produces a block with **no** `Register` row. Also confirm the pre-existing assertion at
`:562` (`expect(SERVER).toContain('() => voidAlertContent(')`) still passes.

`npx vitest run src/__tests__/email-templates.test.ts`

**A-T4. Whole suite + types (nothing else regressed).**
`npx vitest run` and `pnpm typecheck`

**A-T5. RLS / migration negative test.** This slice adds **no migration and no table**,
so there is no cross-tenant read to test. Prove it rather than assert it:

```
node scripts/check-migration-safety.mjs        # must exit 0
git diff --name-only origin/main -- supabase/  # must print NOTHING
```

(If a future track adds the deferred `automation_fires` migration, its RLS negative test
is: as an `authenticated` role from tenant B, `select * from public.automation_fires` must
return **zero rows** — in fact it must error on permission, because the table grants
nothing to `authenticated` at all.)

**A-T6. The live E2E — BLOCKED, and must stay blocked.**
The real flow is: a void happens → the sentinel fires → the owner gets an alert naming the
register. **There has never been a void in this data** (§ C), so this cannot be run today.
Do not fake it and do not mark the track done without it. The unblocking step is one
founder action:

1. Founder voids **one** test transaction at a known register (note which: e.g. POS1).
2. Re-run the probe: `select raw_data->>'invoiceNo', raw_data->>'isVoid', raw_data->>'registerId', raw_data->>'registerName' from rapidrms.invoice_report where raw_data->>'isVoid' <> 'false';`
3. Confirm the row appears **with** `registerId`/`registerName` populated — that also
   closes the last UNVERIFIED item in § D (register fields on voided rows specifically).
4. Confirm the alert email/SMS arrives and contains the register label.

Until then, the strongest available proof is A-T1..A-T5 plus an **operator-run** sentinel
observation: on the VPS, with the sentinel enabled, confirm a pass logs no error and exits
at `src/server.ts:479`. That is an operator step, not Codex's — Codex must not restart or
deploy anything.

### B-block — Slice B

**B-T1. Pure intent + renderer, new file `src/__tests__/exception-intent.test.ts`.**

```ts
import { isExceptionsQuestion, exceptionSummaryLines } from '../chat/exception-intent';

describe('isExceptionsQuestion', () => {
  it('matches the aros#168 battery question verbatim', () => {
    expect(isExceptionsQuestion('Any voids or suspicious transactions I should look at?')).toBe(true);
  });
  it('matches plain forms', () => {
    for (const q of ['any voids today?', 'show me voided transactions', 'exceptions this week'])
      expect(isExceptionsQuestion(q)).toBe(true);
  });
  it('does NOT hijack the plain invoice list or a sales question', () => {
    expect(isExceptionsQuestion('show me my last 10 invoices')).toBe(false);
    expect(isExceptionsQuestion('what were my total sales today?')).toBe(false);
  });
});

describe('exceptionSummaryLines', () => {
  const base = { supportedTypes: ['void'], unsupportedTypes: ['refund', 'no_sale', 'cashier'], partial: false, daily: [] };

  it('zero voids is a real answer, not an error', () => {
    const out = exceptionSummaryLines('Calhoun FMT', '2026-07-17', '2026-07-23', { ...base, totals: { void: { count: 0, amount: 0 } } }).join('\n');
    expect(out).toContain('No voided transactions');
    expect(out).toContain('Calhoun FMT');
  });

  it('names what the POS cannot report instead of printing zeros for it', () => {
    const out = exceptionSummaryLines('Calhoun FMT', '2026-07-23', '2026-07-23', { ...base, totals: { void: { count: 0, amount: 0 } } }).join('\n');
    expect(out).toContain('refunds');
    expect(out).toContain('per-cashier attribution');
    expect(out).not.toMatch(/refunds?:\s*0/i);
  });

  it('renders a real void total with its daily breakdown', () => {
    const out = exceptionSummaryLines('Calhoun FMT', '2026-07-22', '2026-07-23', {
      ...base, totals: { void: { count: 2, amount: 55.25 } },
      daily: [{ businessDate: '2026-07-22', count: 1, amount: 42.75 }, { businessDate: '2026-07-23', count: 1, amount: 12.5 }],
    }).join('\n');
    expect(out).toContain('2 voids, $55.25');
    expect(out).toContain('2026-07-22: 1 void, $42.75');
  });

  it('SCORER GUARD: never emits a chat-eval failure phrase', () => {
    const out = exceptionSummaryLines('Calhoun FMT', '2026-07-23', '2026-07-23', null).join('\n').toLowerCase();
    for (const bad of ['the store', 'try again later', 'contact an administrator', 'unable to retrieve', 'could not be loaded'])
      expect(out).not.toContain(bad);
  });
});
```

`npx vitest run src/__tests__/exception-intent.test.ts`

**B-T2. Route-level check against a locally running server** (no prod, no deploy):

```bash
npx tsx src/server.ts     # port 5457
curl -s -X POST http://127.0.0.1:5457/v1/chat \
  -H 'content-type: application/json' -H 'x-channel: aros' \
  -d '{"agentId":"aros-agent","tenantId":"<a real tenant uuid>","messages":[{"role":"user","content":"Any voids or suspicious transactions I should look at?"}]}'
```
Pass = `_shre.mode === 'aros-store-data-direct'` and `_shre.toolsUsed` contains
`mib_exception_summary`. **Fail = the reply came back from the router proxy** (no
`aros-store-data-direct` mode) — that means the intent did not match.
Without a connected tenant this returns the "no connected RapidRMS store" line from
`src/server.ts:4854`; that still proves the routing fix, which is what aros#168 is about.

**B-T3. The chat-eval harness — the check that actually closes aros#168.**
The `voids` question is already in the battery
(`scripts/chat-eval/battery.json:26-30`, domain `integrity`, `expectSubstance`, 35s budget).
**Do NOT use `--all`.** The fleet sweep mints a Supabase admin magiclink session for
**every active workspace owner** (`run.mjs:103-117`) and fires all 12 battery questions
per tenant at production — real metered chat billed to tenants who did not ask for it.
It is deliberately OFF (`chat-eval-nightly.ps1:5-6`, `scripts/chat-eval/README.md:80-85`)
and this track has no standing to turn it on. One workspace answers the `voids` question
just as well, because `voids` is one question on one battery:

```bash
# single workspace — the same account and shape the nightly already uses
cd /opt/aros-platform && set -a && source .env && set +a && \
  node scripts/chat-eval/run.mjs --base https://app.aros.live
```

**This is a FOUNDER/OPERATOR step, not Codex's** — it requires a production credential and
performs a real sign-in, and an account-lockout risk is live on that login (track E,
step 0: the stored eval password returns 401 as of `2026-07-24T00:17:28Z`). **Codex must
not run it, must not substitute `--all`, and must not attempt any login to work around a
missing credential.** Codex's deliverable is B-T1 + B-T2 — both offline/local and both
sufficient to prove the routing fix. The founder or an operator runs B-T3 after deploy,
once track E's step 0 has closed the 401, and closes aros#168 when the `voids` row scores
`pass`.

---

## Non-goals

Things this track must **not** touch. Each is a lane boundary, and the first three are
evidence-backed refusals, not laziness.

1. **No `cancelled transaction` trigger.** `invoice_report.status` has exactly two values
   ever recorded — `COMPLETED` (19,935) and NULL (1,045). There is no cancel state
   anywhere in the payload, in the column, or in `connectors/rapidrms-bos.ts` (which
   contains zero cancel/void/register/discount references). The nearest signal is
   `invoiceItemLog` `operation='Remove'` / `fieldName='Item'` (77 entries, 60 invoices) —
   an item removed mid-sale. **Shipping that under the label "cancelled transaction"
   would be a lie.** DEFERRED, not a BOS-capture sub-task: BOS has no cancel surface either.
2. **No `price change` trigger.** The complete `invoiceItemLog.fieldName` set (listed in
   § A) contains no `Price`. `operation='Change'` pairs only with `QtyChange` (189/189).
   A register-level price-override trigger has no source. The *pricebook* price-change
   feature is a **different** feature that already has code
   (`collectItemChanges`, `connectors/data-service.ts:595`) and is itself unverified —
   do not conflate the two, and do not "fix" `PRICE_CHANGED_FIELDS` by guessing names.
3. **No `manual discount` trigger.** "A discount was applied" is real and could ship
   ("alert me when a discount over $X is applied"), but the manual-vs-promotional
   discriminator is empirically flat: 206/206 `itemDiscountDetail` entries are the
   identical tuple. **Do not ship the word "manual"** — that specific claim has no
   verified contract. If the founder wants the amount-threshold version, it is a new,
   separately-gated track that also needs the deferred `automation_fires` migration.
4. **Do not add any key to `AUTOMATION_CATALOG_EVENT` (`src/automation/rules.ts:20`),
   `TRIGGER_LABELS` (`:85`), or `NOTIFICATION_CATALOG` (`src/notifications.ts:28`).**
   Those three are the trigger whitelist; touching them means a new trigger is shipping,
   which this track explicitly does not do.
5. **Do not write any migration.** Not `automation_fires`, not `event_subscriptions`.
   `git diff origin/main -- supabase/` must be empty (A-T5).
6. **Do not change `EXCEPTION_SUPPORTED_TYPES` / `EXCEPTION_UNSUPPORTED_TYPES`**
   (`connectors/data-service.ts:401-402`), even though the live data partly contradicts
   the `cashier` and `refund` entries. Correcting them requires knowing what `userName`
   identifies, which is unverified. See § Stop conditions.
7. **Do not touch `src/server.ts:4494`** (the scheduled shift/tender refusal). It is
   arguably now over-broad given `rapidrms.shift_report` has 31 rows, but tender breakdown
   is still empty (`total_discount` 0/31, `total_refund` 0/31, `cashier_name` 0/31) so the
   refusal is still substantially true. Revisiting it is a separate decision.
8. **Do not fork the golden-record layer.** `canonical_entity`, `entity_alias`,
   `canonical_strong_key`, `merge_candidate`, `negative_pair`, `merge_event`,
   `resolveCanonical()`, `src/golden/store.ts` `createGoldenStore()` are merged on main
   (PRs #108/#143). A register is **not** a canonical entity in this track — it is a
   display label on a message. Creating a second identity-resolution path is an
   automatic stop.
9. **No UI work.** No `apps/web` changes, no new pages, no `/notifications` panel change.
   Nothing here alters a user journey, so the journey gate in the repo's `CLAUDE.md`
   does not apply — state that explicitly in the PR body ("no journey altered").
10. **No PAN, ever.** Nothing in this track reads payment data; `invoicePaymentDetail`
    exists in the payload and must not be touched, logged, or rendered.
11. **No deploys, restarts, pushes, or PR merges by the executor.** Read-only probes of
    live systems are fine; writes to any production database are not.

---

## Collision warnings

### Package file-ownership register (RESOLVED 2026-07-24 — authoritative, identical in every brief)

This brief was written without visibility of the eight sibling briefs; they live
beside it in `docs/briefs/`. **One owning track per contested file. The arrows are
a merge order, not a preference.**

| File | OWNER (creates / restructures) | Merge order | Rule for non-owners |
|---|---|---|---|
| `src/server.ts` `/v1/chat` dispatch block (`:6783-6792`) + the four deterministic handlers | **C** (`c-honest-data-contract`) — introduces `arosChatJson()`, the single reply choke point | **C → D → I → A** | **You are third.** Slice B's `exceptions` branch emits through `arosChatJson` with a `Provenance` (it prints a count and an amount) and types its zero via `classifyZero`/`describeZero`. **D** lands before you (inserts a 5th handler line, does not touch `handleArosStoreDataChat`); **A** lands after you (wraps every handler line in a capture shim). Neither collides with your branch, but both move the line numbers. |
| `src/server.ts` `proxyRequest` (`:948-1034`) | **B** (`b-auth-401-recovery`) steps 1–3 | **B(1–3) → A** | A different region; not your edit. |
| `connectors/data-service.ts` | **THIS TRACK (I)**, Slice A | — | Additive only (two constants, one exported function, two interface fields, one spread). No other brief in the package touches it. |
| `src/automation/rules.ts` | **THIS TRACK (I)** | — | You *are* the automation work. Non-goal #4 keeps you out of `AUTOMATION_CATALOG_EVENT`/`TRIGGER_LABELS`. |
| `apps/web/src/aros-ai/actions.ts` (NEW) | **D**, extended by **B** | **D → B** | Not this track. |
| `apps/web/src/aros-ai/ArosChat.tsx` | **NOBODY — FROZEN** | — | Verified unmounted dead code. No track in the package edits it. |
| `scripts/chat-eval/triage.mjs` + `triage-core.mjs` | **E** (`e-watchdog-unsilence`) | **E → F** | Not this track. |
| `scripts/chat-eval/core.mjs` | **F** (`f-real-transcript-eval`) steps 3–4 | **F → C(step 10)** | Not this track. |
| `public.platform_settings` DDL | `supabase/migrations/20260723_platform_settings.sql:9-15` | — | Not this track (no migration in either slice). |

**Globally satisfiable merge order for `src/server.ts`:**
**B(1–3) → C(step 3) → D → I(Slice B) → A(migration + steps 4–11) → F(6,7,9,10).**
Inside `scripts/chat-eval/`: **E → F(3,4,5) → C(step 10) → F(6,7,9,10)**.
**Slice A is outside all of this and may land at any point.**

---

- **`src/server.ts` is the single hottest file in the repo — 7,214 lines, and the last
  eight commits that touched it span email, wallet (×3), automation, rapidrms (×2), and
  EDI.** Both slices touch it, **and tracks A, B, C and D touch it too** (see the register
  above). Mitigation, in order:
  1. Keep every server edit to the exact lines listed (A5: four small edits; B2: three).
     All real logic lives in the pure modules — that is why Slice B gets its own
     `src/chat/exception-intent.ts` instead of inlining a regex ladder.
  2. `git fetch origin && git log --oneline origin/main -5` and re-read the anchor
     regions **immediately before committing**. If `origin/main` has moved past
     `9b4a693`, re-verify every `src/server.ts` line number in this brief before editing.
  3. Slice A and Slice B should be **two PRs**, not one. They are independent and the
     second one rebases cleanly if the first lands first.
- **`connectors/data-service.ts` (858 lines)** is co-edited by connector/RapidRMS work.
  Slice A adds two constants, one exported function, two interface fields, and one spread
  — all additive. No existing behaviour changes, so a merge conflict here is textual, not
  semantic.
- **`src/automation/rules.ts`** is currently only touched by automation work. This track
  is the automation work. Low risk — but any *other* track adding a trigger will collide
  head-on at `AUTOMATION_CATALOG_EVENT`/`TRIGGER_LABELS`. Non-goal #4 keeps this track
  out of that region entirely.
- **`docs/missions/aros-automation-rules.md` is uncommitted in the primary checkout**
  (`C:/Users/nirpa/Documents/Projects/aros`) and a concurrent session is live on that
  checkout. **Never run a branch-switching or tree-mutating git command in
  `C:/Users/nirpa/Documents/Projects/aros` or `C:/Users/nirpa/Documents/Projects/shreai`.**
  Read other refs with `git show origin/main:<path>` only.
- **PR #202 (`docs/retail-profiles`) is OPEN** and is the source contract for this track.
  Docs-only; no file overlap. No sequencing required.
- **The Cortex warehouse is production.** Every query in this brief is `SELECT`. Never
  issue a write, and never attempt a RapidRMS **login** — an account-lockout risk is live
  (track E).

---

## Rollback

Slice A and Slice B are independently revertible; neither has a schema or a data
migration, so a revert is complete — there is no state left behind.

**Immediate kill switch (no deploy needed), if alerts misbehave after Slice A:**
set `AUTOMATION_RULES=0` in the platform environment and restart the process
(`src/server.ts:369` — `if (process.env.AUTOMATION_RULES === '0') return;`). The whole
sentinel stops; nothing else on the platform is affected. That is an operator action.

**Slice A revert:** `git revert <sha>`. `StoreInvoice`, `InvoiceLike`, and
`VoidAlertFacts` lose the additive nullable fields; `voidAlertMessage` returns to the
byte-identical string that regression test A-T2 pins. No `automation_fires` row, no
`event_subscriptions` row, and no `notification_preferences` row is shaped by this slice,
so nothing persisted needs cleanup. Alerts already delivered mentioning a register are
simply historical emails.

**Slice B revert:** `git revert <sha>`, or, if a partial rollback is wanted, delete the
one line added to `storeChatIntent` — `handleArosStoreDataChat`'s new branch becomes
unreachable and "any voids?" falls back to today's router-proxy behaviour (i.e. back to
the aros#168 symptom). `src/chat/exception-intent.ts` is a leaf module with no importers
after that, so it can be left in place or deleted; either way nothing else references it.

**If register identity turns out to be absent on real voided rows** (the one unverifiable
in § D): no revert is needed. `registerLabel` returns `null`, the alert text is byte-identical
to today's, and the email drops the `Register` row. The design degrades to the current
behaviour rather than to a wrong one — which is the whole point of making every register
field nullable.

---

## Stop conditions — come back to the founder, do not assume

Every "See § Stop conditions" reference in this brief resolves here. Q1 and Q2 are the
blocking ones; the rest are tripwires — they block only if you hit them.

**Q1 — [BLOCKING for any claim, not for the code] `isVoid` is `'false'` on 100% of rows
ever synced (1,043/1,043, distinct value set `{'false'}`).** Per § C, `src/server.ts:479`
returns on **every production pass**, so the void alert has never had a real event to fire
on and Slice A improves an unexercised path. Only the founder can close this: **void one
test transaction at a known register, then re-run the read-only probe.** Until then:
- the code still ships (it is cheap, pure and unit-tested), **but**
- neither the PR body nor any journey doc may claim the void alert is proven end-to-end,
  and
- the § D "CONFIRMED-BY-PROXY" caveat on register identity stays in the PR verbatim.

**Recommendation: ship Slice A with the caveat.** The alternative — waiting for a real void
— blocks a purely additive, nullable-by-construction change on an event nobody controls.

**Q2 — [BLOCKING] `EXCEPTION_SUPPORTED_TYPES` / `EXCEPTION_UNSUPPORTED_TYPES` are partly
contradicted by live data, and this track deliberately does not fix them.**
(`connectors/data-service.ts:401-402`; Non-goal 6.) `cashier_name` is populated 20,978/20,980
in Cortex and `userName`/`employeeNo` 1,043/1,043 in the payload, so "cashier attribution is
not available" is at best imprecise. **Do not change these constants here.** What `userName`
identifies — the ringing cashier or the logged-in terminal user — is unverified, and a wrong
attribution on an exception alert is worse than an honest omission.
**Founder question: which identity does `userName` carry?** One answer unblocks a separate,
small track. **Recommendation: leave the constants alone and file the question**, because
the honest-omission behaviour is already correct and a guess here is unrecoverable once it
reaches a customer's inbox.

**Q3 — The seeded mission doc `docs/missions/aros-automation-rules.md` is NOT on
`origin/main`.** It exists only as an uncommitted working-tree file in the primary checkout
`C:/Users/nirpa/Documents/Projects/aros` (§ D). Code comments in `rules.ts` and both
migrations already cite that path as if it were durable. **Do not read the primary
checkout's working tree, and do not cite that path as a ref in anything you write.** If a
reviewer asks you to link it, stop: the founder must decide whether to commit it or to
correct the existing comments. **Recommendation: commit it as-is under `docs/missions/` in a
separate PR** — the citations already exist, so the cheapest fix is to make them true.

**Q4 — You are about to write a migration.** Stop (Non-goal 5). `git diff origin/main --
supabase/` must be empty for this track — acceptance A-T5 asserts it. The one migration this
domain *will* need (`automation_fires.trigger_type`, § Deferred migration) is written out in
full **so the next track does not rediscover it**, and belongs to whichever track ships the
**second** automation trigger type. Shipping it here would widen a unique key nothing yet
uses.

**Q5 — Slice B's exception reply would print a figure with no provenance.** Slice B adds a
branch inside `handleArosStoreDataChat` that returns a void **count and amount** — money.
Track `c-honest-data-contract` owns the reply-provenance contract for exactly these handlers
and is sequenced **before** this track (**C → D → I → A**). If C has landed, emit through its
`arosChatJson()` / provenance envelope; **do not** hand-roll a second reply shape. If C has
**not** landed and you are asked to ship anyway, stop and ask — an un-gated money figure is
the defect that mission exists to remove.

**Q6 — Anything pushes you toward `src/server.ts:4494`** (the scheduled shift/tender
refusal), toward `invoicePaymentDetail`, or toward printing a cashier name, a register id or
any card field in a customer-visible string. Hard stop — PCI/C1 boundary and Non-goal 7.
`rapidrms.shift_report` now has 31 real rows, which makes the refusal arguably over-broad,
but tender breakdown is still empty (`total_discount` 0/31, `total_refund` 0/31,
`cashier_name` 0/31) so the refusal remains substantially true. Revisiting it is a separate,
founder-approved decision.

**Q7 — Restarts, deploys, or the `AUTOMATION_RULES=0` kill switch.** Rollback's kill switch
is explicitly *an operator action*. An executor never restarts the platform process, never
deploys, and never runs the sentinel against production to "see if it fires".
