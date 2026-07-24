# Build brief — `c-honest-data-contract`

> **Freshness + typed zero-results: no number without provenance.**
> Executor: Codex, assumed zero prior context on this codebase.
> Author verified every `path:line` below by opening the file in the worktree
> `C:/Users/nirpa/.shre/worktrees/aros/chat-observability` (a clean checkout of
> `Nirlabinc/aros` `origin/main`, HEAD `9b4a693`) and via
> `git show origin/main:<path>` in `C:/Users/nirpa/Documents/Projects/shreai`.
> **Line numbers are `origin/main` truth as of 2026-07-23.** Re-grep before
> editing; `src/server.ts` is 7214 lines and moves.

---

## Track

**What:** every AROS chat answer that contains a number must carry its
provenance (store scope, source connector, `asOf` timestamp, and whether the
data is live / cached / stale / demo), and every zero must be *typed* — the
system must say **why** it is zero, not just print `0`.

**Why:** live evidence, 2026-07-23, production `app.aros.live`, a real liquor
store with real sales:

```
Party Liquor today:
- Total Sales: $0.00
- Transactions: 0
- Average Ticket: $0.00
```
```
top sold items 2026-07-17 to 2026-07-23:
- No item-level sales rows were returned for that range.
```

A full week of zero item rows for a live store, stated as fact, and
indistinguishable from a genuine zero. The user cannot tell whether the store
made no money, the connector is down, the sync is behind, or the field mapper
drifted. That is worse than an error message: it is a confident wrong answer.

**User-visible outcome:** the same questions produce either a number with a
provenance footer, or a typed explanation of the zero. Example after this
track:

```
**Party Liquor** today:
- Total Sales: **$3,008.11**
- Transactions: **135**
- Average Ticket: **$22.28**

_Source: Party Liquor (rapidrms-api) · live · as of 2026-07-23 14:32 America/New_York · 135 of 135 rows mapped_
```

and for the broken case:

```
**Party Liquor** top sold items (2026-07-17 to 2026-07-23):
- I can't stand behind an item ranking for that range. RapidRMS returned 4,812
  sales rows but none of them carried a recognizable item-name + quantity
  field, so ranking them would be a guess, not a zero.

_Source: Party Liquor (rapidrms-api) · unreliable (mapper_drift) · as of 2026-07-23 14:32 America/New_York · 4,812 rows seen, 0 mapped_
```

**The contract this satisfies** (restated in full here so nothing depends on an
uncommitted file — see "Verified ground truth" note 12): when reporting
results, include **store scope**, **source connector**, **`asOf` or fetch
timestamp**, **whether data is live, cached, or synthetic demo data**, and **any
degraded connector state**.

---

## Verified ground truth

Every claim below was read directly. Anything not personally verified is marked
**UNVERIFIED** with what would settle it.

### A. Where the bad answers are produced (aros)

Worktree root for all `aros` paths in this section:
`C:/Users/nirpa/.shre/worktrees/aros/chat-observability`

1. **`src/server.ts:6783-6791` — the `/v1/chat` dispatch, and the single most
   important fact in this brief.** Verbatim:

   ```ts
   if (pathname === '/v1/chat' && method === 'POST') {
     const body = await parseJsonBody(req);
     if (await handleArosHealthPing(req, res, body)) return;
     // Automation intents run before the data intents: "text me when someone
     // voids a transaction" would otherwise be swallowed as a sales question.
     if (await handleArosAutomationChat(req, res, body)) return;
     if (await handleArosStoreDataChat(req, res, body)) return;
     if (await handleArosSalesChat(req, res, body)) return;
     return proxyRequest(req, res, SHRE_ROUTER_URL, body);
   }
   ```

   All four AROS handlers answer **terminally** (`json(res, 200, …); return true`)
   **before** the proxy to `shre-router`. The replies quoted at the top of this
   brief therefore **never reach** shreai's `checkReply()`. Extending only the
   shreai gate provably cannot catch them. This drives the two-choke-point
   design in §5.

2. **`src/server.ts:4232` — `handleArosSalesChat`.** Reads its tenant from the
   request body/headers at `4234` (`arosChatTenant`) and returns early unless it
   is a UUID (`4235`). **No `authenticateRequest`.**

3. **`src/server.ts:4262` — the zero-producing reduce.** Verbatim:

   ```ts
   const totals = daily.reduce((sum, day) => ({ revenue: sum.revenue + day.revenue, transactions: sum.transactions + day.transactions }), { revenue: 0, transactions: 0 });
   ```
   `daily` is `DailyStoreSales[]`. An empty array yields `revenue: 0,
   transactions: 0` with **no branch** distinguishing "no rows returned" from
   "genuinely zero".

4. **`src/server.ts:4272-4275` — the exact live-evidence template.** Verbatim:

   ```ts
   json(res, 200, {
     content: `**${row.name}** ${label}:\n- Total Sales: **$${revenue.toLocaleString(…)}**\n- Transactions: **${totals.transactions.toLocaleString('en-US')}**\n- Average Ticket: **$${averageTicket.toLocaleString(…)}**`,
     _shre: { model: 'aros-store-data', toolsUsed: [...], mode: 'aros-sales-direct', tenantId, from, to, source: 'RapidRMS API' },
   });
   ```
   `_shre` carries `source: 'RapidRMS API'` and `from`/`to` — but **no `asOf`,
   no freshness, no row counts**.

5. **`src/server.ts:4277-4284` — the catch branch.** Content
   `'RapidRMS sales data could not be retrieved right now.'`, `_shre.error =
   'sales_unavailable'`. This is today's **only** connector-down signal, and it
   is prose, not a typed state.

6. **`src/server.ts:4844` — `handleArosStoreDataChat`.** No auth. Iterates
   `connectedConnectorRows(tenantId)` (`4851`) with no member-store scoping.

7. **`src/server.ts:4869` — the second live-evidence string.** Verbatim:

   ```ts
   if (!report?.items.length) lines.push('- No item-level sales rows were returned for that range.');
   ```
   A bare zero with zero discriminating evidence. Sibling bare zeros at `4879`,
   `4887`, `4897`, `4905`.

8. **`src/server.ts:4915-4918` — the store-data reply.** It rebuilds `_shre` by
   hand from `toolsUsed` and **discards `report.fetchedAt` and `report.source`
   that the connector layer already returned**. Provenance exists upstream and
   is thrown away here.

9. **`src/server.ts:4768-4773` — `type ChatStoreIntent`, exhaustive:**
   `top_items | item_changes | invoices | timecard_corrections | timecards`.
   **There is no `low_stock` intent and no `connectors` intent.** Those two
   chat-eval questions fall through to shre-router's LLM lane. The deterministic
   handler roster is exactly four: `handleArosHealthPing` (`4209`),
   `handleArosAutomationChat` (`4632`), `handleArosStoreDataChat` (`4844`),
   `handleArosSalesChat` (`4232`).

10. **`src/server.ts:4781-4794` — `chatDateRange(text)`.** Pure. Produces
    `{from, to}` from natural language with **no validation** — no max span, no
    "is `to` in the future for this store's timezone" check.
    **`src/server.ts:5108-5119` — `validateStoreDateRange(res, from, to, maxDays, label)`**
    already implements the ordering + max-days rules (used with `maxDays = 31`
    at `5128` for `/api/store/items`) but is an *imperative* function that writes
    an HTTP error, and is **never applied to the chat path**.

11. **`src/server.ts:3582-3585` — the honest provenance envelope that ALREADY
    EXISTS** on `/api/dashboard`:

    ```ts
    const dashboard = {
      dataSource: connected
        ? { live: true, connector: storeSummary!.source, fetchedAt: storeSummary!.fetchedAt, partial: storeSummary!.partial }
        : { live: false },
    ```
    Chat must **mirror and extend** this shape, not invent a competing one.

12. **`src/server.ts:4174-4189` — `arosChatTenant`** reads `body.tenantId |
    body.workspaceId | body.tenant_id | body.workspace_id` then headers
    `x-aros-tenant-id | x-workspace-id | x-tenant-id`. **`src/server.ts:4191-4195`
    — `isArosChatContext`** is true when `body.agentId === 'aros-agent'` or
    header `x-channel: aros`. Neither involves a session.
    **`src/server.ts:4632,4647` — `handleArosAutomationChat` DOES call
    `authenticateRequest(req)` and fails closed** (`4648-4652`). That asymmetry
    is real and is why "not permitted" is *declared but not enforced* in this
    track (§5 step 9).

13. **`src/server.ts:756-764`** documents that browser chat requests arrive at
    this proxy **with no bearer** and are accounted to an `aros-platform`
    service identity. Adding auth to the data handlers would change behavior for
    that traffic. **Do not do it in this track.**

14. **`src/server.ts:3679` — `CONNECTOR_COLUMNS`**, verbatim:
    `'id, tenant_id, type, name, config, status, last_tested, last_error, created_at, updated_at'`.
    `last_tested` / `last_error` / `status` are already selected everywhere —
    this is the connector-down evidence, already in hand.
    **`src/server.ts:4953-4963` — `connectedConnectorRows(tenantId)`** selects
    `${CONNECTOR_COLUMNS}, credentials_encrypted` where `status = 'connected'`,
    `.limit(10)`.
    **`src/server.ts:4965-4969` — `decryptedConnectorRecord(row)`** builds the
    `ConnectorRecord` the data-service takes. **Note: it returns only
    `{id, type, name, config, secrets}` — `status`/`last_error`/`last_tested`
    are dropped**, so the shell must read them off the *row*, not the record.

### B. The connector layer (aros `connectors/data-service.ts`)

15. **`connectors/data-service.ts:826-858` — `fetchStoreSalesRange`.** Returns a
    bare `DailyStoreSales[]` (`type DailyStoreSales = { businessDate: string;
    revenue: number; transactions: number }` at `823`). **No `fetchedAt`, no
    `source`, no `available`, no row counts.** It is the *only* connector entry
    point with zero provenance, and it is exactly the one that produced the
    `$0.00`. Its bucket loop at `842-853` silently drops rows twice:

    ```ts
    const businessDate = pickBusinessDate(row) || (from === to ? from : null);
    if (!businessDate || businessDate < from || businessDate > to) continue;   // ← dropped, uncounted
    …
    bucket.revenue += pickNum(row, REVENUE_FIELDS) || 0;                        // ← unmatched field == 0, uncounted
    ```

16. **`connectors/data-service.ts:709-735` — `fetchTopSoldItems`** DOES return
    provenance:

    ```ts
    return {
      mode: 'top_sold',
      items: collectTopSoldItems(rows, limit),
      from, to,
      source: { type: record.type, name: record.name },
      fetchedAt: new Date().toISOString(),
    };
    ```
    Same for `fetchItemChanges` (`737-754`), `fetchStoreInvoices` (`756-776`),
    `fetchStoreTimecardCorrectionDrafts` (`804-821`). **Provenance is already
    produced; only the chat shell drops it** (see ground truth #8).

17. **`connectors/data-service.ts:575-593` — `collectTopSoldItems`**, pure, and
    it **discards the row count**:

    ```ts
    export function collectTopSoldItems(rows: Array<Record<string, unknown>>, limit = 10): TopSoldItem[] {
      const totals = new Map<string, TopSoldItem>();
      for (const row of rows) {
        if (isVoided(row)) continue;
        const name = pickStr(row, NAME_FIELDS);
        const qty = pickNum(row, ITEM_QTY_FIELDS);
        if (!name || qty === null) continue;   // ← silently dropped, uncounted
        …
    ```
    Therefore `items.length === 0` conflates **"zero rows from the API"** with
    **"rows returned but nothing matched `NAME_FIELDS` + `ITEM_QTY_FIELDS`"**
    (mapper drift). **This missing row count is the single piece of evidence the
    whole design needs.**

18. **`connectors/data-service.ts:229-274` — `fetchRapidRmsSummary` is the
    in-repo reference implementation of typed honesty.** Read its comments; the
    brief's thesis is already written there:

    ```ts
    // `partial` means the SALES numbers are unreliable (fetch failed or rows
    // carried no recognizable revenue field). …
    if (!sawRevenue && counted > 0) partial = true; // rows existed but no revenue field matched   ← line 251
    } catch { partial = true; }                                                                     ← line 253
    // Inventory — … when unreadable, report it UNAVAILABLE rather than
    // claiming "0 low stock" (a lie) …                                                             ← lines 256-258
    ```
    **Generalize this taxonomy; do not invent a new one.**

19. **`connectors/data-service.ts:289-291` — `hasSummaryMapper(type)`** returns
    `true` only for `'rapidrms-api'`. Single source of truth for "can this
    connector type ever produce numbers" → the `unsupported_connector` evidence.

20. **`connectors/data-service.ts:100-115` — the declarative field-mapping
    rules** (`REVENUE_FIELDS`, `SALES_DATE_FIELDS`, `NAME_FIELDS`,
    `ITEM_CODE_FIELDS`, `ITEM_QTY_FIELDS`, `ITEM_TOTAL_FIELDS`, …). Already
    "rules as data". The mapper-drift evidence (which candidate field matched,
    if any) must be derived **from these arrays only** — see the PCI rule in §4.
    `connectors/data-service.ts:95-99` carries a `TODO(real-tenant)` admitting
    these lists were never validated against a live tenant response.

21. **`connectors/data-service.ts:515-540` — `StoreItemsReport` /
    `StoreItemChangesReport` / `StoreInvoicesReport`** already carry `source` +
    `fetchedAt`; `StoreItemChangesReport` additionally carries `available:
    boolean` and an optional `note?: string`. **Extend these types; do not add a
    parallel envelope.**

22. **Callers of the functions this track touches** (`grep`, verified):
    `fetchStoreSalesRange` → `src/server.ts:141` (nightly snapshotter),
    `4131` (`/api/store/sales`), `4261` (chat), `5683` (`store_sync_jobs`
    worker). `collectTopSoldItems` → `connectors/data-service.ts:728` and
    `src/__tests__/store-risk-exception-data.test.ts:117`. `fetchTopSoldItems` →
    `src/server.ts:4866` (chat), `5141` (`/api/store/items`).
    **Four callers each ⇒ signature changes are breaking. Use the additive
    pattern in §5.**

### C. Evidence sources already in the schema (aros `supabase/migrations/`)

23. **`20260714_tenant_connectors.sql:15-16`** — `last_tested timestamptz`,
    `last_error text`; **:22-23** — `CHECK (status IN ('pending','connected',
    'disconnected','error'))`; **:33** — `ALTER TABLE … ENABLE ROW LEVEL
    SECURITY` with the comment "Service-role access only". → `connector_down`.

24. **`20260715_store_snapshots.sql:16`** — `captured_at timestamptz NOT NULL
    DEFAULT now()`; **:25** — `CONSTRAINT store_snapshots_unique_day UNIQUE
    (tenant_id, business_date)`; **:31** — RLS enabled, service-role only.
    → the `cached` freshness band.

25. **`20260716_store_sync_jobs.sql:7-10,13,17`** — `cursor_date date NOT NULL`,
    `status text … CHECK (status IN ('queued','running','completed','failed',
    'cancelled'))`, `last_error text`, `updated_at timestamptz`; **:27** — RLS
    enabled. → `sync_stale`.

26. **`20260720_tenant_member_stores.sql:6-10`** — the deliberate adoption gate,
    verbatim: *"a tenant with ZERO rows here has not adopted site assignment …
    The moment a tenant assigns ANY member, enforcement is strict for everyone
    in that tenant: a site-scoped member with no assignment sees nothing (fail
    closed)."* **:26** RLS enabled, **:29-45** member-select + admin-write
    policies. → `not_permitted`. **The chat handlers ignore this table
    entirely today.**

    **No new table is needed anywhere in this track. This track adds ZERO
    migrations.**

### D. The reply gate (shreai)

Read via `git show origin/main:<path>` in `C:/Users/nirpa/Documents/Projects/shreai`.

27. **`shre-router/src/reply-check.ts:56-62` — `checkReply(text)`**, verbatim:

    ```ts
    export function checkReply(text: string): ReplyCheckResult {
      const reasons: string[] = [];
      if (isBlankOrSkeleton(text)) reasons.push('empty-reply');
      else if (isRawJsonDump(text)) reasons.push('raw-json-dump');
      const leak = findErrorLeak(text);
      if (leak) reasons.push(`error-leak:${leak}`);
      return { ok: reasons.length === 0, reasons };
    }
    ```
    Reasons today are only `empty-reply | raw-json-dump | error-leak:<phrase>`.
    `ERROR_LEAK_PHRASES` is at `:14-25` and has **10** entries.

28. **`shre-router/src/reply-check.ts:70-85` — `honestFallbackText(reasons,
    toolOutput)` — HAZARD.** Its raw-output branch emits:

    ```ts
    return (
      'I retrieved the data but had trouble formatting it into a summary. Raw result:\n\n' +
      '```\n' + data.slice(0, 2000) + '\n```'
    );
    ```
    Up to 2000 chars of raw tool output, which routinely contains currency
    figures with **zero** provenance. A naive provenance rule makes the gate's
    own replacement text fail the gate. §5 step 7 fixes this explicitly.

29. **`shre-router/src/chat-proxy.ts:878-891` — call site 1 (`respondImmediate`).**
    On failure it **replaces** the text via `honestFallbackText` and sets
    `mode: \`${payload.mode}+self-check\``. It does **not** stamp
    `_shre.selfCheck`.

30. **`shre-router/src/chat-nonstream-route.ts:578-589` — call site 2.** The
    **only** place that stamps `(shreExtra as Record<string, unknown>).selfCheck
    = finalCheck.reasons` (`:589`), and it degrades via
    `buildGracefulDegradationText(collectConversationToolResultTexts(...))`
    (`:586-588`), a *different* function from call site 1.
    **Two call sites, two degradation strategies, one of which stamps.**

31. **`shre-router/src/reply-check.test.ts:6`** — an existing green test that
    asserts a figure **without** provenance passes:

    ```ts
    expect(checkReply('**Party Liquor** today: $3,008.11 across 135 transactions.').ok).toBe(true);
    ```
    A figure-requires-provenance rule flips this test. §6 states the exact
    intended new expectation.

32. **`aros scripts/chat-eval/core.mjs:4-13`** — a **third, already-divergent**
    copy of the broken-reply definitions: its own `ERROR_PHRASES` with **8**
    entries, a different list from `reply-check.ts`'s 10 (it has
    `'unable to retrieve'`, `'try again later'`, `'an error occurred'`,
    `'something went wrong'`, `'contact an administrator'` which reply-check
    lacks; it lacks `econnrefused`, `etimedout`, `internal server error`,
    `null pointer`, `traceback…`, `undefined is not`, `unhandled exception`).
    `isEmptyReply` at `:31-37`, `hasErrorPhrase` at `:39-42`, `scoreReply` at
    `:48-114`, `SALES_TEMPLATE = /total sales:.*transactions:/is` at `:15`.
    If the gate learns "no figure without provenance" and this scorer does not,
    the nightly eval and the send-time gate grade the same reply differently.

33. **The vendoring precedent — the sanctioned way to share one definition
    across the two repos.**
    - Canonical source: shreai **`shre-rapidrms/contracts/platform/`**
      (`role-bundle.v1.schema.json`, `presets/*.json`, `CHECKSUMS.txt`,
      `checksums.test.mjs`). Regenerator: shreai
      **`shre-rapidrms/scripts/gen-platform-checksums.sh`**.
    - Consumer 1 (same repo, different package): `shre-router/src/role-bundle-grants.ts:39-42`
      resolves the canonical dir at runtime with an env override:
      ```ts
      const PRESETS_DIR =
        process.env.ROLE_BUNDLE_PRESETS_DIR ??
        resolve(import.meta.dirname ?? __dirname, '../../shre-rapidrms/contracts/platform/presets');
      ```
    - Consumer 2 (other repo): aros vendors the files under
      **`contracts/platform/`** with `CHECKSUMS.txt` (header at
      `contracts/platform/CHECKSUMS.txt:1-6`) and a drift-failing test
      **`src/__tests__/contract-vendored-integrity.test.ts`**. Note `:41-50` of
      that test **hard-codes the expected manifest file list** — adding vendored
      files requires updating that array.

### E. Naming, style, and test precedents to copy verbatim

34. **`apps/mcp-aros/src/tools.ts:225-236` — `demoResult()`.** Established
    vocabulary, reuse the key names verbatim:
    ```ts
    const common = {
      tenantId: 'demo_tenant',
      storeIds: args.storeIds || [args.storeId || 'demo_store_001'],
      source: 'synthetic_demo',
      connectorType: 'rapidrms',
      asOf: new Date().toISOString(),
      channel: 'api',
      correlationId
    };
    ```
    `src/__tests__/mcp-aros-tools.test.ts:157-163` already asserts
    `expect(result.source).toBe('synthetic_demo')`.
    **Use `asOf`. Use `source`. Do not introduce a competing vocabulary.**

35. **Functional-core exemplar: `src/automation/rules.ts:1-8`**, verbatim header:
    ```
    /**
     * Automation rules — pure functional core (no I/O).
     * … The imperative shell (src/server.ts) does all reads/writes; everything
     * here is deterministic data-in/data-out …
     */
    ```
    The new module must be written in exactly this style.

36. **Fixture-test exemplar: `src/__tests__/automation-rules.test.ts:1-35`** —
    `import { describe, expect, it } from 'vitest'`, plain literal fixtures, no
    mocks. Also `src/__tests__/store-risk-exception-data.test.ts:1-30` for
    connector-collector fixtures using live-verified RapidRMS field names.

37. **Test wiring — a real gap.** `vitest.config.ts` includes
    `src/**/__tests__/**/*.test.ts`. `package.json` has **no `test` script**
    (only `"test:auth-conformance": "vitest run src/__tests__/auth-conformance.test.ts"`).
    `.github/workflows/standard-ci.yml:66-80` runs `scripts/test.sh`, which
    (`scripts/test.sh:7-15`) checks for `.scripts.test` and, finding none,
    prints `"[test] No test script; skipping strict checks"` and **exits 0**.
    **⇒ Today, none of the 25 vitest suites in `src/__tests__/` run in CI except
    `auth-conformance`.** §5 step 12 addresses this.
    shreai side: `shre-router/package.json` **does** have
    `"test": "node scripts/run-vitest.mjs run"`.

38. **`scripts/chat-eval/battery.json`** — 12 questions
    (`sales-today`, `top-items`, `low-stock`, `voids`, `week-compare`,
    `connectors`, `labor`, `capabilities`, `multi-part`, `off-scope`,
    `llm-canary`, `heartbeat`). **No question asserts provenance today.**
    Runner `scripts/chat-eval/run.mjs:1-21` documents the modes and flags;
    it exits non-zero below `CHAT_EVAL_MIN_PASS` (default `0.7`).

### F. Marked UNVERIFIED

39. **UNVERIFIED — whether the live Party Liquor zero was a genuine zero, mapper
    drift, or a connector failure.** Settling it requires one authenticated
    probe of that tenant's RapidRMS connector, which the no-login constraint
    forbids. Circumstantial evidence points to **mapper drift**: the candidate
    field names at `connectors/data-service.ts:106-109` (`ItemName` / `Qty` /
    `ItemCode` style) do not resemble the actual warehouse columns
    (`item_code`, `item_name`, `barcode` on `rapidrms.invoice_line_item`).
    **This is why `mapper_drift` is a first-class zero type in §4 even though
    the seed listed only five.** *Would verify:* an operator runs one
    authenticated `GET /api/store/items?from=…&to=…` against the tenant and
    inspects the returned `evidence.rowsSeen` after step 3 lands.

40. **UNVERIFIED — what code is actually running on `app.aros.live`.** Prod is
    aros-vps PM2 `aros-platform` at `/opt/aros-platform` on branch
    `live/direct-deploy` with hand-applied hot patches; the truth is
    `DEPLOY-LOG.md` on that box. Everything cited above is `origin/main`.
    *Would verify:* `ssh` to aros-vps and diff `/opt/aros-platform/src/server.ts`
    against `origin/main`. **Do this before claiming the fix is live.**

41. **UNVERIFIED — whether the `shre-router` binary serving prod matches
    `origin/main`.** Concurrent shre-router deploys and a legacy pm2 router
    (killed 2026-07-23) are on record.

42. **UNVERIFIED — whether another in-flight worktree is already adding
    provenance to these handlers.** ~44 aros worktrees exist, several
    chat-adjacent. Worktree HEADs were checked; the 44 working trees were not
    read. See §8.

43. **The SKILL.md standing problem.** `marketplace/claude-code/plugins/
    aros-retail-ops/skills/operate-aros/SKILL.md` requirement text is real and
    verbatim at its **lines 23-27** (`store scope` / `source connector` /
    `` `asOf` or fetch timestamp `` / `whether data is live, cached, or
    synthetic demo data` / `any degraded connector state`) — I opened it at
    `C:/Users/nirpa/Documents/Projects/aros/marketplace/claude-code/plugins/aros-retail-ops/skills/operate-aros/SKILL.md`.
    **But `git ls-tree -r origin/main` shows no `aros-retail-ops` path: the file
    is UNTRACKED, sitting in the primary checkout on another session's branch
    (`feat/chat-first-redesign`).** It is not a repo-of-record contract.
    **Therefore: this brief restates the requirements itself (see §Track) and
    nothing in this track may depend on that file existing.**

---

## Depends on / blocks

**Depends on:** nothing. This track is self-contained and can start immediately.
It adds no migration, no new table, and no auth change.

**Blocks / must be sequenced before — NAMED AND RESOLVED 2026-07-24:**
- **The `/v1/chat` dispatch block (`src/server.ts:6783-6792`) is rewritten by FOUR
  tracks in this package. Declared merge order: `c-honest-data-contract` →
  `d-actionable-errors` → `i-alerts-register-exceptions` → `a-conversation-persistence`
  (C → D → I → A). This track is FIRST.** It introduces `arosChatJson()` as the
  single reply choke point; the three that follow emit through it rather than
  calling `json(res, 200, …)` directly:
  - **D** inserts a fifth handler (`handleArosConnectorHealthChat`) between the
    ping and automation lines, and takes `arosChatJson` in its `deps` object
    instead of `json` for the 200 path.
  - **I** adds an `exceptions` branch inside `handleArosStoreDataChat` that prints
    a **count and a dollar amount** — it must carry a `Provenance`, not a bare
    `json(res, 200, …)`. Your step-3 review criterion
    (`grep -n "json(res, 200" src/server.ts` shows no direct call in ~4200-4930)
    is exactly what catches it.
  - **A** lands last and wraps every handler line in a `captureJsonResponse` shim.
  Both D and I were written package-blind and did not know this track existed;
  their briefs have now been corrected. Full table: §Collision warnings →
  Package file-ownership register.
- **Any track that adds `authenticateRequest` to `handleArosSalesChat` /
  `handleArosStoreDataChat`** (the "not permitted" enforcement increment). This
  track defines the `not_permitted` typed state and the pure function that
  emits it; that track wires the identity. Do them in this order or the second
  one has nowhere to report to.
- **Any chat-eval / observability track** that scores replies: this track adds
  the `no-provenance` scoring family to `scripts/chat-eval/core.mjs` and new
  battery questions.
  **CORRECTION 2026-07-24 — on `scripts/chat-eval/` this track goes LAST, not
  first.** Three tracks edit that directory. Declared order:
  **`e-watchdog-unsilence` (structural rewrite of `triage.mjs`/`triage-core.mjs`)
  → `f-real-transcript-eval` (steps 3/4: `expectSubstance`, new reason families,
  and the `partial-answer` entry in the hard-fail list at `core.mjs:105`)
  → THIS TRACK's step 10** (`hasErrorPhrase` / `scoreReply` / the same
  `core.mjs:105` list). **Step 10 is gated on F's steps 3 and 4 having landed** —
  both edit the identical line. This does **not** move step 3 (`src/server.ts`),
  which still lands first in the package; step 3 and step 10 are two separate PRs.

**Explicitly not coupled to** the golden-record layer (`canonical_entity`,
`entity_alias`, `resolveCanonical()`, `src/golden/store.ts`
`createGoldenStore()`). This track must not touch it and must not introduce a
second identity-resolution path.

---

## Data contract

### 0. Migrations

**None. This track adds zero migrations and zero tables.** All five evidence
sources already exist with RLS enabled (ground truth #23-#26). If you find
yourself writing SQL, **stop** — see §Stop conditions.

### 1. Provenance envelope — the thing every data answer carries

New, in `src/chat/freshness.ts` (aros). Mirrors `/api/dashboard`'s
`dataSource` (ground truth #11) and reuses the `asOf` / `source` vocabulary from
`apps/mcp-aros/src/tools.ts:225-236` (ground truth #34).

```ts
/** How trustworthy the number is right now. */
export type Freshness =
  | 'live'         // fetched from the connector during this request, within band
  | 'cached'       // served from store_snapshots, within band
  | 'stale'        // fetched/captured, but older than the band allows
  | 'demo'         // synthetic_demo — never a real number
  | 'unavailable'; // we have no number we can stand behind

/** Where a number came from. `type` is a tenant_connectors.type value. */
export type DataSourceRef = { type: string; name: string };

/**
 * PCI-SAFE BY CONSTRUCTION. Every string in `mappedFields` /
 * `unmappedCandidates` MUST be an element of one of the declared candidate
 * arrays in connectors/data-service.ts:100-115. Never a key read off a live
 * row, never a value, never a whole row. RapidRMS payloads carry
 * invoicePaymentDetail[].{cardType,accNo,authCode}; those must never appear
 * here, in a log, or in a reply.
 */
export type FetchEvidence = {
  rowsSeen: number;          // rows the connector returned
  rowsMapped: number;        // rows that produced a usable value
  rowsOutOfRange: number;    // rows dropped by the from/to guard
  voidedSkipped: number;     // rows dropped by isVoided()
  mappedFields: string[];    // which declared candidates actually matched
  unmappedCandidates: string[]; // declared candidates that matched nothing
};

export const EMPTY_EVIDENCE: FetchEvidence = {
  rowsSeen: 0, rowsMapped: 0, rowsOutOfRange: 0, voidedSkipped: 0,
  mappedFields: [], unmappedCandidates: [],
};

export type Provenance = {
  /** ISO-8601 fetch or capture timestamp. null ⇒ nothing was fetched. */
  asOf: string | null;
  /** Connector that produced the number. null ⇒ none reached. */
  source: DataSourceRef | null;
  /** Store scope: connector display names actually consulted. */
  storeScope: string[];
  freshness: Freshness;
  /** Age of `asOf` in seconds at classification time. null when asOf is null. */
  ageSeconds: number | null;
  /** Requested window, echoed back so "out of range" is self-evident. */
  range: { from: string; to: string } | null;
  evidence: FetchEvidence;
  /** Set iff the answer is a zero/absence. Exactly one value, never null+figure. */
  zero: ZeroType | null;
  /** IANA tz used to compute the store's business date. */
  timeZone: string;
};
```

### 2. Zero taxonomy

```ts
/**
 * Why a data answer is zero/empty. Exactly ONE applies, resolved by the
 * priority ladder in classifyZero(). Ordered here worst-secret-first:
 * never leak a connector's health to a principal who may not see the store.
 */
export type ZeroType =
  | 'not_permitted'          // principal is not scoped to any store in range
  | 'connector_down'         // fetch threw, or the connector row is error/disconnected
  | 'unsupported_connector'  // hasSummaryMapper(type) === false
  | 'out_of_range'           // requested window is invalid or in the store's future
  | 'sync_stale'             // freshness === 'stale', or a sync job covers the range
  | 'mapper_drift'           // rowsSeen > 0 && rowsMapped === 0 — rows we could not read
  | 'genuine_zero';          // rowsSeen === 0 (or mapped rows that really total zero)
```

The seed named five. **`mapper_drift` and `unsupported_connector` are added
deliberately:** `mapper_drift` is the most likely cause of the actual live
defect (ground truth #39) and is the one state that is *definitely* not a zero;
`unsupported_connector` already exists as a concept at
`connectors/data-service.ts:289` and as `ConnectorSourceStatus.supported` at
`src/server.ts:4940-4946` — typing it costs nothing and prevents a
verifone/azure store silently reporting `$0.00`.

### 3. Freshness policy — rules as declarative data

```ts
export type DataClass =
  | 'sales_today' | 'sales_range' | 'top_items'
  | 'item_changes' | 'invoices' | 'timecards';

export type FreshnessBand = { liveMaxSeconds: number; cachedMaxSeconds: number };

/**
 * PRODUCT POLICY, not a code detail. These are the author's defaults; the
 * founder must confirm them (see Stop conditions). Read: a `sales_today`
 * answer is `live` if asOf is under 5 minutes old, `cached` under 1 hour,
 * `stale` beyond that.
 */
export const FRESHNESS_POLICY: Record<DataClass, FreshnessBand> = {
  sales_today:   { liveMaxSeconds:  5 * 60, cachedMaxSeconds:      60 * 60 },
  sales_range:   { liveMaxSeconds: 15 * 60, cachedMaxSeconds:  6 * 60 * 60 },
  top_items:     { liveMaxSeconds: 15 * 60, cachedMaxSeconds:  6 * 60 * 60 },
  item_changes:  { liveMaxSeconds: 30 * 60, cachedMaxSeconds: 24 * 60 * 60 },
  invoices:      { liveMaxSeconds: 15 * 60, cachedMaxSeconds:  6 * 60 * 60 },
  timecards:     { liveMaxSeconds: 30 * 60, cachedMaxSeconds: 24 * 60 * 60 },
};

/** Max chat query span, matching validateStoreDateRange's REST rule. */
export const CHAT_MAX_RANGE_DAYS = 31;
```

### 4. Pure function signatures (`src/chat/freshness.ts`)

No I/O in this file. Everything is data-in/data-out.

```ts
export function classifyFreshness(input: {
  dataClass: DataClass;
  asOf: string | null;
  now: string;                       // injected — never call Date.now() in here
  origin: 'connector' | 'snapshot' | 'demo' | 'none';
}): { freshness: Freshness; ageSeconds: number | null };

export type ZeroInput = {
  dataClass: DataClass;
  /** 'unknown' until the auth increment lands; ladder skips not_permitted then. */
  permittedStores: number | 'unknown';
  connectorStatus: 'connected' | 'disconnected' | 'error' | 'pending' | 'missing';
  connectorSupported: boolean;
  fetchThrew: boolean;
  range: { from: string; to: string } | null;
  businessToday: string;             // YYYY-MM-DD in the STORE's timezone
  maxRangeDays: number;
  freshness: Freshness;
  syncJob: { status: string; cursorDate: string | null } | null;
  evidence: FetchEvidence;
  /** The computed figure(s); only consulted at the genuine_zero rung. */
  totalIsZero: boolean;
};

/** Priority ladder, first match wins. Returns null when the answer is non-zero. */
export function classifyZero(input: ZeroInput): ZeroType | null;

/** One honest sentence explaining a typed zero. Never prints a fake number. */
export function describeZero(zero: ZeroType, p: Provenance): string;

/**
 * The footer every data answer carries. Format is load-bearing — the reply
 * gate's PROVENANCE_RE matches it.
 *   _Source: Party Liquor (rapidrms-api) · live · as of 2026-07-23 14:32 America/New_York · 135 of 135 rows mapped_
 */
export function provenanceLine(p: Provenance): string;

/** _shre.dataSource — mirrors src/server.ts:3583's dashboard.dataSource. */
export function dataSourceEnvelope(p: Provenance): {
  live: boolean;
  connector: DataSourceRef | null;
  fetchedAt: string | null;   // = asOf; key name matches the dashboard's
  asOf: string | null;        // = asOf; key name matches mcp-aros tools.ts:225
  partial: boolean;           // true when zero is mapper_drift | sync_stale
  freshness: Freshness;
  zero: ZeroType | null;
  storeScope: string[];
  evidence: FetchEvidence;
};
```

**Ladder semantics (exactly one, in this order):**

| # | Returns | When |
|---|---|---|
| 1 | `not_permitted` | `permittedStores === 0` (skipped entirely when `'unknown'`) |
| 2 | `connector_down` | `fetchThrew === true` **or** `connectorStatus` ∈ `{disconnected, error, missing}` |
| 3 | `unsupported_connector` | `connectorSupported === false` |
| 4 | `out_of_range` | `range` invalid: not `YYYY-MM-DD`, `from > to`, span `> maxRangeDays`, or `to > businessToday` |
| 5 | `sync_stale` | `freshness === 'stale'` **or** `syncJob.status` ∈ `{queued, running, failed}` **or** `syncJob.cursorDate < range.to` |
| 6 | `mapper_drift` | `evidence.rowsSeen > 0 && evidence.rowsMapped === 0` |
| 7 | `genuine_zero` | `evidence.rowsSeen === 0` **or** (`rowsMapped > 0 && totalIsZero`) |
| — | `null` | none of the above ⇒ there is a real, non-zero, trustworthy number |

### 5. Connector-layer additions (`connectors/data-service.ts`) — ADDITIVE ONLY

Ground truth #22: each function has 4 callers. **Do not change any existing
signature.** Add siblings and re-express the originals as one-line wrappers so
there is no duplicated logic:

```ts
export type StoreSalesRangeReport = {
  days: DailyStoreSales[];
  from: string;
  to: string;
  source: { type: string; name: string };
  fetchedAt: string;                 // ISO-8601 — the missing asOf
  evidence: FetchEvidence;
};

export async function fetchStoreSalesRangeReport(
  record: ConnectorRecord, vaultSecret: string, from: string, to: string,
): Promise<StoreSalesRangeReport | null>;   // null ⇒ unsupported connector type

/** UNCHANGED signature — now a wrapper. */
export async function fetchStoreSalesRange(...): Promise<DailyStoreSales[]> {
  return (await fetchStoreSalesRangeReport(...))?.days ?? [];
}

export function collectTopSoldItemsWithEvidence(
  rows: Array<Record<string, unknown>>, limit?: number,
): { items: TopSoldItem[]; evidence: FetchEvidence };

/** UNCHANGED signature — now a wrapper. */
export function collectTopSoldItems(rows, limit = 10): TopSoldItem[] {
  return collectTopSoldItemsWithEvidence(rows, limit).items;
}
```

And **one optional field** added to the existing report type (backwards
compatible, `connectors/data-service.ts:515-522`):

```ts
export interface StoreItemsReport {
  mode: 'top_sold';
  items: TopSoldItem[];
  from: string;
  to: string;
  source: { type: string; name: string };
  fetchedAt: string;
  evidence?: FetchEvidence;   // ← NEW, optional
}
```

### 6. Chat reply envelope (aros `/v1/chat` response body)

Unchanged top-level shape; `_shre` gains one key.

```jsonc
{
  "content": "**Party Liquor** today:\n- Total Sales: **$3,008.11**\n…\n\n_Source: Party Liquor (rapidrms-api) · live · as of 2026-07-23 14:32 America/New_York · 135 of 135 rows mapped_",
  "_shre": {
    "model": "aros-store-data",
    "toolsUsed": ["mib_sales_today"],
    "mode": "aros-sales-direct",
    "tenantId": "…uuid…",
    "from": "2026-07-23",
    "to": "2026-07-23",
    "source": "RapidRMS API",

    "dataSource": {                       // ← NEW, = dataSourceEnvelope(p)
      "live": true,
      "connector": { "type": "rapidrms-api", "name": "Party Liquor" },
      "fetchedAt": "2026-07-23T18:32:11.004Z",
      "asOf": "2026-07-23T18:32:11.004Z",
      "partial": false,
      "freshness": "live",
      "zero": null,
      "storeScope": ["Party Liquor"],
      "evidence": {
        "rowsSeen": 135, "rowsMapped": 135, "rowsOutOfRange": 0,
        "voidedSkipped": 2,
        "mappedFields": ["billAmount", "invoiceDate", "invoiceNo"],
        "unmappedCandidates": []
      }
    },
    "selfCheck": []                       // ← NEW: reasons from the aros gate ([] = clean)
  }
}
```

**Existing keys stay.** `_shre.source` (the free-text `'RapidRMS API'` /
`'RapidRMS BOS'`) is not removed — `scripts/chat-eval/run.mjs` and prod
consumers read it.

**Two of these keys are a persisted contract with two other tracks — treat them
as API, not as diagnostics.**

| Key | Type | Persisted by track A as | Consumed by |
|---|---|---|---|
| `_shre.dataSource.zero` | `ZeroType \| null` (§4.2) | `public.chat_message.zero_type text` | track F's `classifyFailure()` — its typed tool-error detector |
| `_shre.selfCheck` | `string[]` — **always present**, `[]` = clean | `public.chat_message.self_check text[]` (`NULL` = key absent) | track F, same function |

Renaming either key, omitting `selfCheck` when it is empty, or changing a
`ZeroType` spelling is a **breaking change for the nightly grader** and must be
announced in both `a-conversation-persistence.md` §15.1 and
`f-real-transcript-eval.md` § Data contract §3a. Adding a *new* `ZeroType` value
is safe — F counts unknown values rather than crashing on them.

### 7. The shared reply-gate contract (crosses both repos)

**Canonical location (shreai, source of truth):**
`shre-rapidrms/contracts/platform/reply-check.v1.json` — alongside
`role-bundle.v1.schema.json`, regenerated into `CHECKSUMS.txt` by
`shre-rapidrms/scripts/gen-platform-checksums.sh` (ground truth #33).

```jsonc
{
  "version": 1,
  "errorLeakPhrases": [
    "circuit breaker", "could not be loaded", "data-source error",
    "econnrefused", "etimedout", "internal server error", "null pointer",
    "traceback (most recent call last)", "undefined is not",
    "unhandled exception"
  ],
  "//figurePatterns": "A reply 'carries a figure' if ANY of these match. Compiled with new RegExp(src, flags).",
  "figurePatterns": [
    { "src": "\\$\\s?\\d[\\d,]*(?:\\.\\d{2})?", "flags": "" },
    { "src": "\\b\\d[\\d,]*(?:\\.\\d+)?\\s*(?:transactions?|invoices?|items?|units?|punches|sold|hours?|h\\b)", "flags": "i" },
    { "src": "\\b\\d+(?:\\.\\d+)?\\s?%", "flags": "" }
  ],
  "//provenancePattern": "A reply 'carries provenance' when this matches. Emitted by provenanceLine() and by honestFallbackText().",
  "provenancePattern": {
    "src": "^_?Source:\\s+.+?(?:·\\s*as of\\s|provenance not established)",
    "flags": "im"
  }
}
```

**Conformance fixtures (also canonical, also checksummed):**
`shre-rapidrms/contracts/platform/reply-check.v1.cases.json`

```jsonc
{
  "version": 1,
  "cases": [
    { "id": "figure-with-provenance", "dataLane": true,
      "text": "**Party Liquor** today: $3,008.11 across 135 transactions.\n\n_Source: Party Liquor (rapidrms-api) · live · as of 2026-07-23 14:32 America/New_York · 135 of 135 rows mapped_",
      "expectReasons": [] },
    { "id": "figure-without-provenance-datalane", "dataLane": true,
      "text": "**Party Liquor** today: $3,008.11 across 135 transactions.",
      "expectReasons": ["no-provenance"] },
    { "id": "figure-without-provenance-llmlane", "dataLane": false,
      "text": "**Party Liquor** today: $3,008.11 across 135 transactions.",
      "expectReasons": [], "expectWarnings": ["no-provenance"] },
    { "id": "no-figure-passes", "dataLane": true, "text": "pong", "expectReasons": [] },
    { "id": "typed-zero-with-provenance", "dataLane": true,
      "text": "I can't stand behind an item ranking for that range. RapidRMS returned 4,812 sales rows but none carried a recognizable item-name + quantity field.\n\n_Source: Party Liquor (rapidrms-api) · unreliable (mapper_drift) · as of 2026-07-23 14:32 America/New_York · 4,812 rows seen, 0 mapped_",
      "expectReasons": [] },
    { "id": "empty", "dataLane": false, "text": "", "expectReasons": ["empty-reply"] },
    { "id": "raw-json", "dataLane": false, "text": "[{\"item\":\"1000 STORIES\",\"qty\":0}]", "expectReasons": ["raw-json-dump"] },
    { "id": "error-leak", "dataLane": false, "text": "connect ECONNREFUSED 127.0.0.1:5497", "expectReasons": ["error-leak:econnrefused"] }
  ]
}
```

**Vendored copy (aros):** both files byte-identical under
`contracts/platform/`, with their sha256 lines appended to
`contracts/platform/CHECKSUMS.txt`, guarded by the existing
`src/__tests__/contract-vendored-integrity.test.ts` (whose hard-coded file list
at `:41-50` must be extended).

**Extended gate signature (shreai `shre-router/src/reply-check.ts`):**

```ts
export type ReplyCheckResult = {
  ok: boolean;
  reasons: string[];      // gate FAILURES — caller replaces/degrades the reply
  warnings?: string[];    // ← NEW: observed but not enforced (stamp-only phase)
};

/** `dataLane: true` = a deterministic AROS data handler ⇒ provenance ENFORCED. */
export function checkReply(text: string, opts?: { dataLane?: boolean }): ReplyCheckResult;
```

`opts` is optional ⇒ **every existing call site keeps compiling unchanged.**

---

## Implementation steps

Steps 1-3 are the "stop discarding what already exists" core and are worth
shipping alone. Steps 4-8 are the gate. Steps 9-12 are wiring and hygiene.

> **Setup, first:** work in a git worktree, never in a primary checkout.
> `Documents/Projects/aros` and `Documents/Projects/shreai` have concurrent
> sessions live on them; branch-switching or tree-mutating git commands there
> will corrupt someone else's work. Use
> `Documents/Projects/shre-dev-kit/scripts/worktree.ps1 add aros feat/honest-data-contract`
> (and the same for `shreai`), which creates
> `~/.shre/worktrees/<repo>/<branch-slug>`. Read other refs with
> `git show origin/main:<path>`.

### Step 1 — pure core: `src/chat/freshness.ts` (aros) — NEW FILE
Write the module defined in §4, with the header style of
`src/automation/rules.ts:1-8`. **No imports from `src/server.ts`, no
`node:fs`, no Supabase, no `Date.now()`** — `now` is always injected.
Export: `Freshness`, `DataSourceRef`, `FetchEvidence`, `EMPTY_EVIDENCE`,
`Provenance`, `ZeroType`, `DataClass`, `FreshnessBand`, `FRESHNESS_POLICY`,
`CHAT_MAX_RANGE_DAYS`, `classifyFreshness`, `classifyZero`, `describeZero`,
`provenanceLine`, `dataSourceEnvelope`.
`describeZero` must produce one honest sentence per type and **must never
print a figure the system does not have**. Suggested text:

| ZeroType | Sentence |
|---|---|
| `not_permitted` | `You're not assigned to any store that covers that request, so I can't show numbers for it. Ask a workspace owner to assign you a store.` |
| `connector_down` | `I couldn't reach {name} ({type}) just now, so I have no number to give you — this is a connection problem, not a zero.` |
| `unsupported_connector` | `{name} is a {type} connector, which AROS can't read sales from yet. That's a gap on our side, not a zero at your store.` |
| `out_of_range` | `{from} to {to} isn't a range I can answer for — {reason}. Give me a window inside the last {maxDays} days ending on or before {businessToday}.` |
| `sync_stale` | `The store data I have is from {asOfHuman} and a sync for that window is still {status}, so a total now would be misleading rather than zero.` |
| `mapper_drift` | `{name} returned {rowsSeen} rows for that range but none of them carried a field I recognize as {what}, so I can't rank/total them. That is unreadable data, not zero sales.` |
| `genuine_zero` | `{name} really did record no {what} between {from} and {to} — {rowsSeen} rows returned, {rowsMapped} readable.` |

*Reviewable when:* the file exists, exports the listed symbols, contains no
`import` of anything doing I/O, and step 4's tests pass.

### Step 2 — additive evidence in `connectors/data-service.ts` (aros)
Runs in parallel with step 1.

a. Add `collectTopSoldItemsWithEvidence(rows, limit)` next to
   `collectTopSoldItems` (`:575`). Move the loop body into it and count:
   `rowsSeen = rows.length`; `voidedSkipped++` at the `isVoided` continue
   (`:578`); `rowsMapped++` only when both `name` and `qty` resolved;
   record which `NAME_FIELDS` / `ITEM_QTY_FIELDS` / `ITEM_TOTAL_FIELDS` /
   `ITEM_CODE_FIELDS` entries actually matched into `mappedFields`, and the
   declared candidates that never matched into `unmappedCandidates`.
   Then reduce `collectTopSoldItems` to `return collectTopSoldItemsWithEvidence(rows, limit).items;`.
b. Add `fetchStoreSalesRangeReport(...)` next to `fetchStoreSalesRange`
   (`:826`). Same body, plus: `rowsSeen = rows.length`; `rowsOutOfRange++` at
   the `continue` on `:846`; `rowsMapped++` only when
   `pickNum(row, REVENUE_FIELDS) !== null` (**today `:848` uses `|| 0`, which
   makes an unmatched field indistinguishable from a genuine zero — that is the
   root defect; count it separately, do not change the arithmetic**);
   `source: { type: record.type, name: record.name }`,
   `fetchedAt: new Date().toISOString()`. Return `null` when
   `record.type !== 'rapidrms-api'` (today it returns `[]` at `:832` — the
   wrapper preserves that: `?? []`).
   Then reduce `fetchStoreSalesRange` to the wrapper in §4.5.
c. Add `evidence?: FetchEvidence` to `StoreItemsReport` (`:515`) and populate it
   in `fetchTopSoldItems` (`:726-733`) from
   `collectTopSoldItemsWithEvidence`.

**PCI rule, enforced by construction:** the only strings ever pushed into
`mappedFields` / `unmappedCandidates` are elements of the constant arrays at
`connectors/data-service.ts:100-115`. Never `Object.keys(row)`. Never a value.
Never log a row. RapidRMS payloads carry
`invoicePaymentDetail[].{cardType, accNo, authCode}`.

*Reviewable when:* `git diff` shows only additions plus two one-line function
bodies replaced by wrappers, and all four existing callers of each function
(ground truth #22) are untouched.

### Step 3 — stamp provenance in the two chat handlers (aros `src/server.ts`)
Depends on steps 1 and 2. **Keep the diff inside `server.ts` small** — this
file is co-edited by many worktrees (§8).

> **SEQUENCING — RESOLVED 2026-07-24. You are FIRST into the `/v1/chat` dispatch
> block (`:6783-6792`); three sibling tracks follow you: C → D → I → A.**
> That means `arosChatJson` must be written to survive them:
> - Export it (or hang it off a module-level `chatDeps`-style object) so track D
>   can pass it into `handleArosConnectorHealthChat`'s `deps` — D's handler is a
>   deterministic AROS handler and its 200 replies go through your choke point.
> - Keep the signature `(res, content, shre, p?)` **stable**; D and I both bind
>   to it, and A wraps the `res` it is handed. A `res`-first signature is what
>   makes A's `captureJsonResponse` shim work unchanged.
> - Do **not** assume the block will keep exactly four handler lines. D adds a
>   fifth. Anchor your edits on function names (`grep -n "function handleAros"`),
>   never on `:6783`.
> Full table: §Collision warnings → Package file-ownership register.

a. Add one shell helper near the chat handlers (~`src/server.ts:4200`):
   ```ts
   /**
    * Single reply choke point for the four deterministic AROS chat handlers.
    * Appends the provenance footer, stamps _shre.dataSource, and runs the
    * shared reply gate (contracts/platform/reply-check.v1.json).
    */
   function arosChatJson(res: ServerResponse, content: string, shre: Record<string, unknown>, p?: Provenance): void
   ```
   It appends `'\n\n' + provenanceLine(p)` when `p` is given, sets
   `shre.dataSource = dataSourceEnvelope(p)`, then (step 8) runs the gate.
b. `handleArosSalesChat` (`:4232-4285`): swap `fetchStoreSalesRange` (`:4261`)
   for `fetchStoreSalesRangeReport`; build a `Provenance` from the report plus
   the connector row's `status` / `last_error` / `last_tested` (available on
   `row` — remember `decryptedConnectorRecord` drops them, ground truth #14);
   call `classifyZero`; when it returns anything other than `null` or
   `'genuine_zero'`, emit `describeZero(...)` **instead of** the figure template
   at `:4273`; otherwise emit the existing template. Replace both
   `json(res, 200, …)` calls (`:4272`, `:4279`) with `arosChatJson(...)`. The
   catch branch (`:4277`) passes a `Provenance` with `fetchThrew: true`,
   `freshness: 'unavailable'`.
c. `handleArosStoreDataChat` (`:4844-4928`): **stop discarding
   `report.fetchedAt` / `report.source`** — collect them per store into a
   `Provenance` and pass it to `arosChatJson` at `:4915`; replace the bare zero
   at `:4869` with `describeZero(...)` using `report.evidence`; do the same for
   the sibling bare zeros at `:4879`, `:4887`, `:4897`, `:4905` using
   `genuine_zero` where no better evidence exists. `hasSummaryMapper(row.type)`
   returning false at `:4863` currently `continue`s silently — record it as
   `unsupported_connector` in that store's provenance instead.
d. Range validation: in `storeChatIntent` (`:4808`) leave the regex router
   alone; instead have `arosChatJson`'s caller pass `range` into `classifyZero`,
   which applies the `out_of_range` rung (rung 4) using
   `CHAT_MAX_RANGE_DAYS` and `businessToday(storeTimezone(record.config))`
   (`connectors/data-service.ts:126`). **Do not call
   `validateStoreDateRange` (`:5108`) from chat — it writes an HTTP 400 and
   would break the chat contract.**
e. `handleArosHealthPing` (`:4209`) and `handleArosAutomationChat` (`:4632`):
   route their `json(res, 200, …)` through `arosChatJson` **with no
   `Provenance`** (they carry no store figures). This is what makes "one choke
   point" true.

*Reviewable when:* `grep -n "json(res, 200" src/server.ts` shows no direct call
inside lines ~4200-4930, and every reply path in the four handlers goes through
`arosChatJson`.

### Step 4 — fixture tests for the pure core (aros)
New: `src/__tests__/chat-freshness.test.ts` and
`src/__tests__/store-data-evidence.test.ts`. Detail in §6. Runs in parallel
with step 3.

### Step 5 — canonical gate contract (shreai)
Create `shre-rapidrms/contracts/platform/reply-check.v1.json` and
`reply-check.v1.cases.json` exactly as in §4.7. Regenerate the manifest with
`shre-rapidrms/scripts/gen-platform-checksums.sh` and commit the updated
`shre-rapidrms/contracts/platform/CHECKSUMS.txt` in the same commit as the
files (lockstep is the rule stated in that file's header, `:1-6`).

### Step 6 — extend the gate (shreai `shre-router/src/reply-check.ts`)
Depends on step 5.
- Add `warnings?: string[]` to `ReplyCheckResult`.
- Add the optional second parameter: `checkReply(text, opts?: { dataLane?: boolean })`.
- Add `export function carriesFigure(text: string): boolean` and
  `export function carriesProvenance(text: string): boolean`, compiled from the
  policy constants.
- New rule: if `carriesFigure(text) && !carriesProvenance(text)` then
  push `'no-provenance'` into **`reasons` when `opts?.dataLane === true`**, else
  into **`warnings`**. This is the staged rollout: LLM-lane prose is observed,
  the deterministic AROS lane is enforced.
- Hold the policy as a frozen literal in the TS (so `tsc`/`dist` never needs a
  cross-package file read at runtime — the hazard that `role-bundle-grants.ts`
  works around with an env var), and add a test asserting the literal deep-equals
  `JSON.parse(readFileSync('shre-rapidrms/contracts/platform/reply-check.v1.json'))`.
  Drift becomes a loud local failure.
- **Do not touch `ERROR_LEAK_PHRASES` semantics** — move the list into the
  policy literal, same 10 entries, same order.

### Step 7 — make the gate's own fallback provenance-honest (shreai)
Depends on step 6. `honestFallbackText` (`shre-router/src/reply-check.ts:70-85`)
raw-output branch currently emits up to 2000 chars of tool output containing
naked figures — which the new rule would flag. **Append a provenance line to
that branch** so the gate's output satisfies the gate honestly rather than being
exempted:

```
…\n```\n<raw>\n```\n\n_Source: unverified — raw tool output, provenance not established._
```

The `provenancePattern` in §4.7 matches `provenance not established`
specifically so this works. This is why the pattern has that alternation.

### Step 8 — aros-side choke point using the same contract
Depends on steps 3, 5, 7.
- Vendor `reply-check.v1.json` + `reply-check.v1.cases.json` into aros
  `contracts/platform/`, byte-identical, and append their sha256 lines to
  `contracts/platform/CHECKSUMS.txt`.
- Extend the hard-coded expected file list in
  `src/__tests__/contract-vendored-integrity.test.ts:41-50` (it asserts an exact
  sorted array — it will fail until you do).
- New file `src/chat/reply-gate.ts`: loads the vendored JSON once at module
  load with `readFileSync` and implements the same three predicates
  (`carriesFigure`, `carriesProvenance`, `checkArosReply(text, { dataLane })`).
  Returns `{ ok, reasons, warnings }`. **Pure apart from the one module-load
  read.**
- Wire it into `arosChatJson` (step 3a): compute
  `checkArosReply(content, { dataLane: !!p })`, stamp
  `shre.selfCheck = result.reasons`, and **in this track, log-and-stamp only —
  do not replace the reply.** Log via the existing `console.error`/`console.warn`
  style used at `src/server.ts:4278` with a `[aros-reply-gate]` prefix.
  Enforcement (replacement) is the follow-up increment; see §Stop conditions.
- **`selfCheck` is a persisted cross-track contract, not a log field.** Always
  set the key, **including when the array is empty** — `[]` means "the gate ran
  and found nothing", and omitting the key means "no gate ran". Track A stores
  the difference in `chat_message.self_check` (`text[]`, NULL vs `'{}'`) and
  track F's `classifyFailure()` reads it. Collapsing `[]` to "omit" makes every
  clean reply indistinguishable from an ungraded one in the nightly report.
  Same rule for `dataSource.zero`: on a data path it is always present, `null`
  when the answer is not a zero. *Reviewable when:* every `arosChatJson` reply
  path, in a local `curl` against `:5457`, returns a body where
  `jq -e '._shre | has("selfCheck")'` exits 0.

### Step 9 — declare `not_permitted`, do not enforce it
`classifyZero` accepts `permittedStores: number | 'unknown'`; the shell passes
`'unknown'` for now, and the ladder skips rung 1. **Do not add
`authenticateRequest` to `handleArosSalesChat` or `handleArosStoreDataChat`
in this track** (ground truth #12, #13 — it would change behavior for
bearer-less browser traffic and for the `aros-platform` service passport).
Leave a one-line comment at each handler's tenant-derivation site pointing at
the follow-up.

### Step 10 — unify the eval scorer (aros `scripts/chat-eval/core.mjs`)

> **GATED — RESOLVED 2026-07-24. `scripts/chat-eval/core.mjs` is owned by
> `f-real-transcript-eval` (its steps 3 and 4), not by this track. Step 10 lands
> AFTER F's steps 3/4 have merged.** Both edit the same hard-fail list at
> `core.mjs:105` — F adds `partial-answer` there, you add `no-provenance`. Landing
> out of order means one of the two entries is silently dropped on rebase and the
> corresponding family stops hard-failing, which no test in either brief would
> catch. Order for the whole directory: **E → F(3,4,5) → C(step 10)**.
> Before starting, run
> `git log --oneline origin/main -- scripts/chat-eval/core.mjs` and confirm F's
> commits are present. This step is a **separate PR** from step 3 — do not bundle
> them; step 3 lands early, this lands late.

Depends on step 8 **and on F's steps 3/4** (see the gate above). Delete the divergent `ERROR_PHRASES` (`:4-13`) and rewrite
`hasErrorPhrase` (`:39-42`) to read `errorLeakPhrases` from the **vendored**
`contracts/platform/reply-check.v1.json`. Add a scoring family in `scoreReply`
(`:48`): when `question.checks.expectProvenance` is true and the reply carries a
figure without provenance, push
`` `no-provenance: reply states a figure with no source/asOf` `` and include
`no-provenance` in the `hardFail` list at `:105`.

> **What that deletion used to break, and why it no longer does — read before
> you delete.** `ERROR_PHRASES` at `core.mjs:4-13` holds **8** phrases; the
> router's `ERROR_LEAK_PHRASES` (`git show origin/main:shre-router/src/reply-check.ts`,
> `:14-25`) holds **10**, and contains **none** of `unable to retrieve`,
> `try again later`, `an error occurred`, `something went wrong`,
> `contact an administrator`. Replacing the first list with the second is
> therefore a **narrowing**, not a unification, on exactly the phrases that
> production tool-failure replies actually use (aros#168's verbatim text matches
> two of the five that go away and zero of the ten that stay).
>
> Track **`f-real-transcript-eval`** used to grade aros#168 with
> `hasErrorPhrase`, so this step would have silently turned its tool-error
> detector off. **That coupling has been removed:** F now detects tool failures
> with `classifyFailure()` over the **typed** columns
> `error_code` / `zero_type` / `self_check` / `http_status` (F's Data contract
> §3a), and F's brief carries an explicit test asserting that the #168 *wording*
> with clean typed fields does **not** fail. So: **do not widen
> `errorLeakPhrases` to a union to compensate. Delete the list as written.**
> Wording is this track's to own.
>
> **The obligation this creates on you (steps 3 and 8):** F's detector is only
> as good as the typed fields you stamp. Every reply the four AROS handlers emit
> must carry `_shre.selfCheck` (`[]` when clean — **present, not omitted**) and,
> on any data path, `_shre.dataSource.zero`. A handler that returns an apology
> with `selfCheck` absent and `zero` unset is now invisible to the nightly
> grader. That is the trade this step makes, and it is only sound if steps 3 and
> 8 are complete first — which is why step 10 depends on step 8.

### Step 11 — new battery questions (aros `scripts/chat-eval/battery.json`)
Add five questions that exercise the zero types, each with
`"checks": { "expectProvenance": true }`:
`sales-today-provenance`, `top-items-provenance`,
`future-range` (`"What were my sales on 2099-01-01?"` → expects `out_of_range`
language, must not print `$0.00`), `oversized-range`
(`"Show me sales for the last 400 days"` → `out_of_range`), and
`unsupported-store` (only meaningful for a tenant with a non-rapidrms
connector; mark it `"skipIfSingleConnector": true` and have `run.mjs` skip it —
or omit it and note why). Keep `latencyBudgetMs` at `5000` for the two
deterministic ones, matching the existing `sales-today` budget (`battery.json:8`).

### Step 12 — make the tests actually run (aros `package.json`, CI)
Ground truth #37: none of these tests run in CI today.

#### The ONE `package.json` `"test"` value — shared by tracks C, D and F, do not deviate

Verified: `package.json` has **no** `test` script today, so
`.github/workflows/standard-ci.yml:66-80` → `scripts/test.sh:7-15` → `jq -e '.scripts.test'`
misses → prints `No test script; skipping strict checks` → **exit 0**. The CI test step is a
no-op.

Three briefs in this package each prescribed a *different* replacement (`vitest run`,
`vitest run`, and `node --test scripts/chat-eval/ && pnpm typecheck && pnpm lint`). Whoever
landed second would have silently deleted the other's suite from CI. **Settled — add exactly
these two scripts, byte-identical, in whichever of C/D/F lands first. The other two tracks
then assert they are already present and change nothing:**

```json
"test": "pnpm test:unit && node --test scripts/chat-eval/ && pnpm typecheck && pnpm lint",
"test:unit": "vitest run"
```

Why this shape:
- `pnpm test:unit` — the vitest suite tracks C and D need.
- `node --test scripts/chat-eval/` — the `node:test` suites track F needs. **Directory form
  on purpose:** F's step 1 adds `transcript-core.test.mjs`, and directory discovery picks it
  up with no further `package.json` edit. If your Node build does not auto-discover from a
  directory, use `node --test scripts/chat-eval/*.test.mjs` — same semantics, still one line,
  still no per-track edit.
- `&& pnpm typecheck && pnpm lint` — **not optional** (track F's argument stands): once
  `.scripts.test` exists, `scripts/test.sh` runs `pnpm test` and returns at `:16`, so the
  `elif` branch that would otherwise have run typecheck+lint becomes unreachable. Keeping
  them inside `test` is strictly more coverage than the repo has today.
- The split into `test:unit` exists so the red-suite escape hatch below touches **one line**
  and `"test"` itself never has to change again.

**Escape hatch — if `pnpm vitest run` is already red on `origin/main` before your change:**
do **not** add a blanket suite that newly fails CI for reasons this package did not cause,
and do **not** drop vitest from `"test"`. Narrow **`test:unit` only**, to an explicit
space-separated list of the test files this package owns, e.g.

```json
"test:unit": "vitest run src/__tests__/chat-freshness.test.ts src/__tests__/store-data-evidence.test.ts"
```

appending your track's files to whatever list is already there (**append-only** — never
rewrite another track's entries), and report the pre-existing failures in the PR body.
`"test"` itself stays byte-identical in every case.

**Reviewer check (all three tracks):** `jq -r '.scripts.test' package.json` returns the exact
string above, and `git diff origin/main -- package.json` never shows `"test"` re-invented by
a second track.

**For this track specifically:** run `pnpm vitest run` on a clean `origin/main` first, then
apply the block above. If the suite is red, this track's four files are what you append to
`test:unit`:
`src/__tests__/chat-freshness.test.ts src/__tests__/store-data-evidence.test.ts src/__tests__/reply-gate.test.ts src/__tests__/contract-vendored-integrity.test.ts`.
Do **not** invent a separate `test:chat-honesty` script and do **not** append a new step to
`.github/workflows/standard-ci.yml` — the settled `"test"` value is already reached by
`scripts/test.sh` from the existing workflow step, and a parallel CI step would be a second
source of truth.

**Parallelism:** steps 1, 2, 5 in parallel. Then 3, 4, 6 in parallel. Then 7, 8.
Then 9-12.

---

## Acceptance tests

All commands assume `cwd` = your aros worktree root unless stated.

### T1 — Freshness banding, pure, fixtures (NEW: `src/__tests__/chat-freshness.test.ts`)
Style: copy `src/__tests__/automation-rules.test.ts:1-35` — vitest,
`describe/it/expect`, plain literal fixtures, **no mocks**.

Must cover, at minimum:
- `classifyFreshness` boundaries for **every** `DataClass`: exactly at
  `liveMaxSeconds` (→ `live`), one second past (→ `cached`), exactly at
  `cachedMaxSeconds` (→ `cached`), one second past (→ `stale`),
  `asOf: null` (→ `unavailable`, `ageSeconds: null`), `origin: 'demo'`
  (→ `demo` regardless of age).
- `classifyZero` — **one test per rung asserting the rung wins over every rung
  below it.** e.g. a fixture that is simultaneously `fetchThrew: true` **and**
  `rowsSeen: 0` must return `'connector_down'`, not `'genuine_zero'`.
- `classifyZero` returns `null` when there is a real non-zero number.
- `out_of_range` cases: `from > to`; span 400 days; `to` = tomorrow in the
  store's tz; malformed `2026-7-3`.
- `mapper_drift` vs `genuine_zero`: `{rowsSeen: 4812, rowsMapped: 0}` →
  `mapper_drift`; `{rowsSeen: 0, rowsMapped: 0}` → `genuine_zero`.
- `provenanceLine` output **matches the `provenancePattern` regex** from the
  vendored `contracts/platform/reply-check.v1.json` — read the JSON in the test
  so the format and the gate can never drift apart.
- `describeZero` output for every `ZeroType` **contains no `$` and no bare
  digit-group that could read as a total** for the non-`genuine_zero` types.

```
npx vitest run src/__tests__/chat-freshness.test.ts
```

### T2 — Connector evidence, pure, fixtures (NEW: `src/__tests__/store-data-evidence.test.ts`)
Style: copy `src/__tests__/store-risk-exception-data.test.ts:1-30`, which already
uses live-verified RapidRMS field names.

- `collectTopSoldItemsWithEvidence([])` → `{ items: [], evidence: { rowsSeen: 0, rowsMapped: 0, … } }`.
- **The live-defect fixture:** rows using the *warehouse* column names that the
  mapper does **not** know —
  `[{ item_name: 'FIREBALL 750', item_qty: 3, item_code: '080686000129' }, …]`
  (candidate lists at `connectors/data-service.ts:106-109` contain
  `ItemName`/`Qty`/`ItemCode`, **not** `item_name`/`item_qty`) → expect
  `items: []` **and** `evidence.rowsSeen > 0, rowsMapped: 0`, and
  `classifyZero` on that evidence → `'mapper_drift'`. **This is the test that
  proves the brief's thesis.**
- A mixed fixture: 3 mappable rows + 1 voided + 2 unmappable →
  `rowsSeen: 6, rowsMapped: 3, voidedSkipped: 1`.
- `collectTopSoldItems(rows)` (the wrapper) returns **exactly** what it returned
  before — assert against the existing expectation at
  `src/__tests__/store-risk-exception-data.test.ts:117`.
- **PCI negative test:**
  ```ts
  const rows = [{ ItemName: 'X', Qty: 1, invoicePaymentDetail: [{ cardType: 'VISA', accNo: '4111111111111111', authCode: '00123' }] }];
  const { evidence } = collectTopSoldItemsWithEvidence(rows);
  const blob = JSON.stringify(evidence);
  for (const bad of ['accNo', 'cardType', 'authCode', '4111', '00123']) {
    expect(blob).not.toContain(bad);
  }
  ```

```
npx vitest run src/__tests__/store-data-evidence.test.ts
```

### T3 — Gate conformance, both repos, one fixture file
The **same** `reply-check.v1.cases.json` drives both implementations.

aros (NEW `src/__tests__/reply-gate.test.ts`): loads
`contracts/platform/reply-check.v1.cases.json`, runs `checkArosReply(c.text,
{ dataLane: c.dataLane })` over every case, asserts `reasons` deep-equals
`c.expectReasons` and (when present) `warnings` contains `c.expectWarnings`.

```
npx vitest run src/__tests__/reply-gate.test.ts
```

shreai (`shre-router/src/reply-check.test.ts`, EXTENDED): same loop against
`checkReply`. Plus these **explicit expectation changes**, which the reviewer
must see:

- **`shre-router/src/reply-check.test.ts:6` changes.** Today:
  ```ts
  expect(checkReply('**Party Liquor** today: $3,008.11 across 135 transactions.').ok).toBe(true);
  ```
  Becomes **two** assertions making the staged rollout explicit:
  ```ts
  // LLM lane: observed, not enforced — still ok, but warned.
  const llm = checkReply('**Party Liquor** today: $3,008.11 across 135 transactions.');
  expect(llm.ok).toBe(true);
  expect(llm.warnings).toContain('no-provenance');
  // Deterministic AROS data lane: enforced.
  const lane = checkReply('**Party Liquor** today: $3,008.11 across 135 transactions.', { dataLane: true });
  expect(lane.ok).toBe(false);
  expect(lane.reasons).toContain('no-provenance');
  ```
- The existing `it('does not flag its own fallback text')` block must be
  extended with `{ dataLane: true }`:
  ```ts
  expect(checkReply(honestFallbackText(['raw-json-dump'], '[{"revenue":3008.11}]'), { dataLane: true }).ok).toBe(true);
  ```
  This passes **only** after step 7 stamps the fallback. If you skip step 7,
  this test tells you.

```
cd <shreai worktree>/shre-router && pnpm test
```

### T4 — Vendored-contract drift guard (EXISTING test, extended list)
Proves aros's copy of the gate contract is byte-identical to shreai's.

```
npx vitest run src/__tests__/contract-vendored-integrity.test.ts
```

Must pass **after** you add the two files to `contracts/platform/`, append their
lines to `contracts/platform/CHECKSUMS.txt`, and extend the hard-coded expected
list at that test's `:41-50`. To prove the guard works, temporarily change one
character in the vendored JSON and confirm the test fails.

### T5 — RLS negative check (no new tables; regression only)
This track adds no migration, but it reads three service-role-only tables
(`tenant_connectors`, `store_snapshots`, `store_sync_jobs` — RLS enabled at
`20260714_tenant_connectors.sql:33`, `20260715_store_snapshots.sql:31`,
`20260716_store_sync_jobs.sql:27`) and one member-scoped table
(`tenant_member_stores`, `20260720_tenant_member_stores.sql:26`). Prove nothing
regressed, **read-only, against a non-production Supabase project**:

```bash
# Anon key ⇒ must return ZERO rows on the service-role-only tables.
curl -s -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  "$SUPABASE_URL/rest/v1/store_sync_jobs?select=id&limit=5"      # expect []
curl -s -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  "$SUPABASE_URL/rest/v1/store_snapshots?select=id&limit=5"      # expect []
curl -s -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  "$SUPABASE_URL/rest/v1/tenant_connectors?select=id&limit=5"    # expect []
```
Cross-tenant: with tenant A's authenticated JWT, select
`tenant_member_stores` filtered to tenant B's id → **expect `[]`**.
**No writes. Never against production.**

Also run the repo's own migration guard, which must stay green:
```
node scripts/check-migration-safety.mjs
```

### T6 — Live E2E: the real flow, the real defect
This is the one that proves it. Run against a **local** aros server, not prod.

```bash
# terminal 1
npx tsx src/server.ts            # port 5457

# terminal 2 — the exact question that produced "$0.00"
curl -s -X POST http://127.0.0.1:5457/v1/chat \
  -H 'content-type: application/json' -H 'x-channel: aros' \
  -d '{"agentId":"aros-agent","tenantId":"<TENANT_UUID>","messages":[{"role":"user","content":"What were my total sales today?"}]}' \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s);console.log(r.content);console.log(JSON.stringify(r._shre.dataSource,null,2));})"
```

**Pass criteria:**
1. `content` contains a `_Source: … · as of …_` line.
2. `_shre.dataSource.asOf` is a non-null ISO-8601 timestamp.
3. `_shre.dataSource.freshness` ∈ `{live, cached, stale, unavailable}`.
4. `_shre.dataSource.evidence.rowsSeen` is a number.
5. **If the answer is zero, `_shre.dataSource.zero` is a non-null `ZeroType`
   and `content` explains which one — `$0.00` alone is a FAIL.**
6. `_shre.selfCheck` is `[]`.

Repeat for the second live-evidence question:
`"what were my top sold items from 2026-07-17 to 2026-07-23"`, and for
`"What were my sales on 2099-01-01?"` (must return `out_of_range` language, must
**not** print `$0.00`).

### T7 — Eval battery, scored offline and login-free — **NO LOGIN** (Stop conditions 2, 11)

`run.mjs --email/--password` performs a real Supabase password sign-in through
`POST /api/login` (`run.mjs:63-67`). **Do not run it, in any form, on any base.**
`src/server.ts:1176-1189` implements a progressive lockout keyed `email:ip`, the
only stored eval credential already returns 401 as of `2026-07-24T00:17:28Z`, and
the account is the founder's own production login — which they currently cannot
get into. This test proves the same two things without authenticating.

**T7a — the new `expectProvenance` questions, against a LOCAL server, no bearer.**
Same bearer-less shape as T6 and for the same verified reason: the deterministic
handlers run before the `/v1/*` proxy hop and take the tenant from the body
(`arosChatTenant`, `src/server.ts:4174`, reads `body.tenantId` first).

```bash
# terminal 1
npx tsx src/server.ts            # port 5457

# terminal 2 — no Authorization header anywhere
cd C:/Users/nirpa/.shre/worktrees/aros/chat-observability
export CHAT_EVAL_DIR="$PWD/scripts/chat-eval"
export TENANT=<TENANT_UUID>
node --input-type=module -e "$(cat <<'JS'
import { readFileSync } from 'fs';
import { pathToFileURL } from 'url';
const dir = process.env.CHAT_EVAL_DIR;
const { scoreReply } = await import(pathToFileURL(dir + '/core.mjs').href);
const battery = JSON.parse(readFileSync(dir + '/battery.json','utf8')).questions;
let bad = 0;
for (const q of battery.filter(x => x.checks?.expectProvenance)) {
  if (q.checks.skipIfSingleConnector) { console.log(`${q.id}: SKIPPED (needs a non-rapidrms connector)`); continue; }
  const t0 = Date.now();
  const res = await fetch('http://127.0.0.1:5457/v1/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-channel': 'aros' },
    body: JSON.stringify({ agentId: 'aros-agent', tenantId: process.env.TENANT,
                           messages: [{ role: 'user', content: q.question }], stream: false }),
  });
  const data = await res.json();
  let reply = data.response ?? data.message ?? data.content ?? '';
  if (reply && typeof reply === 'object') reply = reply.content ?? JSON.stringify(reply);
  const s = scoreReply(q, reply, {}, { latencyMs: Date.now() - t0 });
  console.log(`${q.id}: ${s.verdict} ${s.reasons.join('; ')}`);
  if (s.verdict !== 'pass') bad++;
}
console.log(bad ? `FAIL (${bad})` : 'PASS');
JS
)"
```

Pass criteria: every non-skipped `expectProvenance` question prints `pass`, and the
last line is `PASS`. A `no-provenance` reason here is a real failure of step 9's
stamping, not of the test.

**T7b — no previously-passing answer regressed, scored offline from archived replies.**
Step 10 changes `hasErrorPhrase`, so the risk is that a reply that used to pass now
fails (or worse, one that used to fail now passes). Re-score the stored replies of
the last known-green nightly run — no network, no credential:

```bash
export R=C:/Users/nirpa/.shre/worktrees/aros/chat-eval-main/scripts/chat-eval/reports/2026-07-23T06-53-41
node --input-type=module -e "$(cat <<'JS'
import { readFileSync } from 'fs';
import { pathToFileURL } from 'url';
const dir = process.env.CHAT_EVAL_DIR;
const { scoreReply } = await import(pathToFileURL(dir + '/core.mjs').href);
const battery = JSON.parse(readFileSync(dir + '/battery.json','utf8')).questions;
for (const line of readFileSync(process.env.R + '/results.jsonl','utf8').trim().split('\n')) {
  const row = JSON.parse(line);
  const q = battery.find(x => x.id === row.id);
  // ground-truth-free checks only: run.mjs does not persist groundTruth to results.jsonl
  if (!q || q.checks?.expectCurrencyFrom || q.checks?.expectAnyFrom) continue;
  const now = scoreReply(q, row.reply, {}, { latencyMs: row.ms });
  if (now.verdict !== row.score.verdict)
    console.log(`MOVED ${row.id}: ${row.score.verdict} -> ${now.verdict} (${now.reasons.join('; ')})`);
}
console.log('done');
JS
)"
```

**EXPECT: no `MOVED` line.** That archived run (12/12 at `2026-07-23T06:53:41Z`) **is**
the baseline — do not try to regenerate one with `git stash` + a live run, because
regenerating it requires the login this test exists to avoid.

**T7c — [FOUNDER-EXECUTED, optional, not a merge gate].** The full authenticated
battery, if the founder wants live confirmation. Blocked on track E step 0 closing
the 401 and on a deliberately re-set eval credential landing in OpenBao (track E,
Stop conditions Q3/Q4). Single workspace, never `--all`, never from an executor:

```bash
# founder only. --all is a cross-tenant fleet sweep and stays OFF (chat-eval-nightly.ps1:5-6).
node scripts/chat-eval/run.mjs --base http://127.0.0.1:5457
# reads CHAT_EVAL_EMAIL / CHAT_EVAL_PASSWORD from the environment
```
Pass criteria: aggregate pass rate does not drop below the archived baseline above.

### T8 — Journey gate
`CLAUDE.md` in the aros repo requires a Journey Spec for user-facing capability
changes. This track changes what the chat *says*, which is user-facing.
Either update the relevant spec under `docs/journeys/` (index:
`docs/journeys/README.md`) with the new honest-zero states, or state explicitly
in the PR body that no journey's success signal changed and why. Then walk the
surface: `node scripts/journey-walk.mjs --base http://127.0.0.1:5457`.

---

## Non-goals

Do **not** touch any of the following in this track:

1. **Auth on the data handlers.** No `authenticateRequest` in
   `handleArosSalesChat` or `handleArosStoreDataChat` (ground truth #12, #13).
   `not_permitted` is declared and stubbed only.
2. **Re-routing the deterministic handlers through shre-router.** The
   `battery.json` latency budgets are explicitly tuned for the fast path
   (`battery.json:2`). Architecturally attractive, out of scope, would need a
   separate latency-budget decision.
3. **Reply *replacement* by the aros gate.** Step 8 stamps and logs. Turning
   `no-provenance` into a wholesale reply replacement in the aros lane is the
   next increment, after a stamped-only observation window.
4. **Any migration, any new table, any RLS policy change.** All five evidence
   sources exist.
5. **The golden-record layer** — `canonical_entity`, `entity_alias`,
   `canonical_strong_key`, `merge_candidate`, `negative_pair`, `merge_event`,
   `resolveCanonical()`, `src/golden/store.ts` `createGoldenStore()`. A second
   identity-resolution path is an automatic stop.
6. **`connectors/data-service.ts` arithmetic.** Add counters; do not change how
   revenue or quantities are computed. Specifically leave
   `bucket.revenue += pickNum(row, REVENUE_FIELDS) || 0` (`:848`) computing the
   same number — only *count* the unmatched case alongside it.
7. **Existing exported signatures**: `collectTopSoldItems`,
   `fetchStoreSalesRange`, `fetchTopSoldItems`, `collectItemChanges`,
   `checkReply`'s first parameter. Four callers each.
8. **`ERROR_LEAK_PHRASES` semantics.** Relocate the list into the policy file;
   same 10 strings, same order. Changing the list is a separate decision.
9. **`buildGracefulDegradationText`** (shreai `shre-router/src/graceful-degradation.ts`).
   Unifying the two divergent degradation strategies at
   `chat-proxy.ts:878` and `chat-nonstream-route.ts:586` is real work but is not
   this track. Note it in the PR body.
10. **The MCP surfaces** (`apps/mcp-aros/`). They already carry `asOf` +
    `source` (ground truth #34). Read them for naming; do not modify them.
11. **`marketplace/claude-code/plugins/aros-retail-ops/`.** Untracked work on
    another session's branch (ground truth #43). Do not commit it, do not
    depend on it.
12. **Prod.** No deploys, no restarts, no writes to any production database.

---

## Collision warnings

### Package file-ownership register (RESOLVED 2026-07-24 — authoritative, identical in every brief)

This brief was written package-blind. The eight sibling briefs live beside it in
`docs/briefs/`. **One owning track per contested file. The arrows are a merge
order, not a preference.**

| File | OWNER (creates / restructures) | Merge order | Rule for non-owners |
|---|---|---|---|
| `src/server.ts` `/v1/chat` dispatch block (`:6783-6792`) | **THIS TRACK (C)** — you introduce `arosChatJson()`, the single reply choke point | **C → D → I → A** | You are first. **D** inserts a 5th handler (`handleArosConnectorHealthChat`) and takes `arosChatJson` in its `deps`; **I** adds an `exceptions` branch inside `handleArosStoreDataChat` that must carry a `Provenance` (it prints a count and an amount); **A** lands last and wraps every handler line in a capture shim. Keep `arosChatJson`'s signature stable and `res`-first. |
| `src/server.ts` `proxyRequest` (`:948-1034`) | **B** (`b-auth-401-recovery`) steps 1–3 | **B(1–3) → A** | A different region. B's ~40 lines land before everything else in the package. Not your edit. |
| `apps/web/src/redesign/ConciergeChat.tsx` | shared — **B** rewrites the failure half of `send()`, **you** read `_shre` on the success half (`:127-133`), **D** adds the `actions` read + `onAction` prop, **A** adds a `conversationIdRef` | **B → C → D → A** | All four edit the same ~40 lines. Land serially; re-read immediately before each edit. |
| `apps/web/src/aros-ai/actions.ts` (NEW) | **D** | **D → B** | Not this track. |
| `apps/web/src/aros-ai/ArosChat.tsx` | **NOBODY — FROZEN** | — | Verified unmounted dead code (declaration at `:41`, five comment-only refs, no import, no mount; `AppShell.tsx:3,:240` mounts `ConciergeChat`). No track edits it. |
| `scripts/chat-eval/triage.mjs` + `triage-core.mjs` | **E** (`e-watchdog-unsilence`) | **E → F** | Not this track — you touch neither file. |
| `scripts/chat-eval/core.mjs` | **F** (`f-real-transcript-eval`) steps 3–4 | **F → C(step 10)** | **Your step 10 is gated on F.** Both edit the hard-fail list at `core.mjs:105`. |
| `scripts/chat-eval/run.mjs` | **F** step 8 | — | Not this track. |
| `src/chat/redact.ts` + `src/chat/__fixtures__/pan-redaction.json` (NEW) | **D** (`d-actionable-errors` §Data contract 6a) — the package's **one** PAN redactor (`redactPan`, Luhn-gated) plus the shared fixture list | **D → A**; F mirrors | Not this track. Your evidence strings and typed-zero payloads must never carry a PAN: if one could, **import `redactPan`** rather than adding a digit rule to `arosChatJson` or the reply gate. |
| `public.platform_settings` DDL | `supabase/migrations/20260723_platform_settings.sql:9-15` | — | Not this track (no migration). |

**Globally satisfiable merge order for `src/server.ts`:**
**B(1–3) → C(step 3) → D → I → A(migration + steps 4–11) → F(6,7,9,10).**
Inside `scripts/chat-eval/`: **E → F(3,4,5) → C(step 10) → F(6,7,9,10)**.
**This track therefore ships as two PRs at two different times:** step 3 (server)
early, step 10 (core.mjs) late. Do not bundle them.

---

1. **`src/server.ts` is the hot file.** 7214 lines, live in ~44 worktrees,
   several chat-adjacent: `feat/chat-rich-input-aros`,
   `fix/aros-chat-health-ping`, `chat-eval-main`, `fix/chat-suggestions-subtle`,
   `feat/chat-eval-harness`, `feat/chat-first-redesign`.
   **Mitigation, and it is the whole reason the design is shaped this way:**
   all new logic lives in `src/chat/freshness.ts` and `src/chat/reply-gate.ts`;
   the `server.ts` diff should be **one new ~20-line helper plus ~10 changed
   call sites**. If your `server.ts` diff exceeds ~60 lines, you have put logic
   in the wrong file.
2. **The primary aros checkout is dirty and on another branch.**
   `C:/Users/nirpa/Documents/Projects/aros` is on `feat/chat-first-redesign`
   with ~25 uncommitted files including `src/server.ts` and `connectors/*`, and
   that branch **does not even contain `handleArosStoreDataChat`**. Never run a
   tree-mutating git command there. Same for
   `C:/Users/nirpa/Documents/Projects/shreai`.
3. **Prod is not `origin/main`.** `app.aros.live` runs aros-vps PM2
   `aros-platform` at `/opt/aros-platform` on `live/direct-deploy` with
   hand-applied hot patches; truth is `DEPLOY-LOG.md` on that box. Any
   "as-built" claim must be qualified. Reconciling the hot patches is somebody's
   job, not this track's — but **do not assume your merge to `main` reaches
   users.**
4. **`scripts/chat-eval/*` — OWNERSHIP RESOLVED 2026-07-24. It is not vaguely
   "co-owned"; it has named owners per file.**
   - `triage.mjs` + `triage-core.mjs` → **`e-watchdog-unsilence`** (structural:
     `classifyRun`/`runErrorIntent`/`digestText`, the optional-`results.jsonl`
     rewrite at `triage.mjs:36`, and `allIntents` replacing `issues` at the
     `planIssueActions` call, `:61`). **This track does not touch either file.**
   - `core.mjs` → **`f-real-transcript-eval`** steps 3/4 (`expectSubstance`, the
     new reason families, `partial-answer` in the hard-fail list at `:105`).
     **Your step 10 lands after F.** See the gate on step 10.
   - `run.mjs` → **F** step 8. `from-transcripts.mjs` (new file) → **A** step 11.
   Directory order: **E → F(3,4,5) → C(step 10)**. Also still true: the harness
   track `aros#130` (worktrees `chat-eval-main` / `feat/chat-eval-harness`) is
   live on this directory — run
   `git log --oneline origin/main -- scripts/chat-eval/` before step 10 and rebase
   rather than force through a conflict.
5. **`contracts/platform/CHECKSUMS.txt` exists in two repos** and its files must
   be updated in lockstep (rule stated in its own header, `:1-6`). If you commit
   the JSON to shreai without regenerating the manifest, aros's
   `contract-vendored-integrity.test.ts` will fail for the next person, not for
   you.
6. **`shre-router` has concurrent deploys on record** and a legacy pm2 router was
   killed on 2026-07-23. Do not restart or deploy anything.
7. **`package.json` `"scripts"` — three tracks in THIS package edit the same
   two lines.** Tracks **C (step 12)**, **D (step 12)** and **F (step 0)** all add a
   `"test"` script, and each originally prescribed a different value; whoever landed
   second would have silently removed the other's suite from CI. The value is now
   settled and written byte-identically in all three briefs (step 12 above).
   **Before editing `package.json`, run `jq -r '.scripts.test' package.json`.** If it
   already returns the settled string, another track landed first — assert it and change
   nothing. If it returns something else, **stop and reconcile**; do not overwrite.
8. **`_shre.dataSource.zero` + `_shre.selfCheck` are consumed downstream — you
   are now an upstream producer for two other tracks.** Track
   `a-conversation-persistence` persists them as real columns
   (`chat_message.zero_type text`, `chat_message.self_check text[]`, its §4.1 /
   §15.1) and track `f-real-transcript-eval` grades on them
   (`classifyFailure()`, its Data contract §3a). This replaced F's old detector,
   which matched the reply phrases **your step 10 deletes** — the two changes
   were on a collision course and the fix was to move F onto your typed fields.
   Consequences for this track:
   - **Never omit `selfCheck`.** `[]` and absent are different values downstream.
   - **Do not rename `zero` or a `ZeroType` spelling** without updating both
     sibling briefs; *adding* a value is safe.
   - **Step 10 must not land before step 8.** Deleting the phrases while the
     handlers are not yet stamping leaves a window with no tool-error detection
     on either side. The step-10 gate already sequences this — respect it.
9. **UNVERIFIED (ground truth #42):** another in-flight worktree may already be
   adding provenance to these handlers. Before writing step 3, run
   `git log --all --oneline -- src/server.ts | head -30` and
   `git branch -a --contains $(git rev-parse origin/main) | head` in the aros
   worktree, and grep the other chat worktrees for `asOf` / `fetchedAt` inside
   `handleAros`. If someone got there first, **stop and reconcile** rather than
   duplicating.

---

## Rollback

The track is deliberately built so each layer can be reverted independently.

**If the reply gate misbehaves (most likely failure — false `no-provenance`):**
- The aros gate is **stamp-only** by design (step 8). Worst case it writes noisy
  `[aros-reply-gate]` logs and a non-empty `_shre.selfCheck`. **No user-visible
  regression is possible from the aros gate in this track.**
- shreai side: `no-provenance` only enters `reasons` when
  `opts.dataLane === true`. Nothing in shre-router passes `dataLane: true` in
  this track, so the LLM lane is warn-only. To neutralize entirely, revert
  `shre-router/src/reply-check.ts` to the previous commit — its public API is
  unchanged (the new param is optional), so no call site needs touching.

**If the chat handlers regress (wrong text, crash):**
- Revert the `src/server.ts` commit only. `src/chat/freshness.ts`,
  `src/chat/reply-gate.ts`, and the `connectors/data-service.ts` additions are
  inert without their call sites — the connector changes are additive with
  wrapper-preserved signatures, so `/api/store/sales`, `/api/store/items`, the
  nightly snapshotter (`src/server.ts:141`) and the sync worker (`:5683`)
  behave byte-identically.

**If a connector-layer counter is wrong:**
- `fetchStoreSalesRange` and `collectTopSoldItems` are pure wrappers over the new
  evidence functions and return exactly what they returned before. Revert
  `connectors/data-service.ts` alone; the chat handlers then fail to compile,
  so revert step 3 with it. Nothing else depends on the new exports.

**If the vendored contract drifts:**
- Delete the two files from aros `contracts/platform/`, remove their lines from
  `CHECKSUMS.txt`, and restore the expected-file array in
  `src/__tests__/contract-vendored-integrity.test.ts:41-50`. `src/chat/reply-gate.ts`
  goes with it.

**Prod:** nothing in this track is deployed by this track. `app.aros.live` runs
hand-patched code on `live/direct-deploy`; rolling forward there is a separate,
operator-gated action documented in that box's `DEPLOY-LOG.md`.

**Git:** each step above should be its own commit so `git revert <sha>` is
surgical. Commit author per house rule: `Nirav Patel <info@rapidinfosoft.com>`.

---

## Stop conditions — come back to the founder, do not assume

1. **The freshness band numbers in `FRESHNESS_POLICY` (§4.3) are product policy,
   not a code detail.** They are the author's defaults. If you disagree with any
   of them, or a stakeholder does, **stop and get them fixed** — do not silently
   invent different numbers.
2. **If the live probe shows the Party Liquor zero is a *genuine* zero** (ground
   truth #39 is UNVERIFIED), the whole framing changes and `mapper_drift` may be
   the wrong first-class type. An operator must run **one** authenticated probe
   to settle it. **Do not attempt a login yourself — an account-lockout risk is
   live on this workspace.**
3. **If you conclude the gate must REPLACE replies** (rather than stamp) to be
   useful, stop. Reply replacement in the aros lane turns every
   currently-passing deterministic AROS reply into a replaced reply until
   provenance is stamped everywhere — that takes AROS chat from
   wrong-but-plausible to unusable. Sequencing is a founder decision, not an
   implementation detail.
4. **If you find yourself writing a migration, creating a table, or adding an
   RLS policy** — stop. All five evidence sources already exist (§4.0). A new
   table means you have misread the design.
5. **If you find yourself adding `authenticateRequest` to
   `handleArosSalesChat` or `handleArosStoreDataChat`** — stop. That changes
   behavior for bearer-less browser traffic and the `aros-platform` service
   passport (ground truth #13). Separate, gated increment.
6. **If another worktree already added provenance to these handlers** (§8.7) —
   stop and reconcile. Do not ship a second implementation.
7. **If the aros vitest suite is red before your changes** (ground truth #37
   makes this plausible — those suites do not run in CI) — do **not** stop, and do
   **not** invent a different `"test"` value. Step 12 now carries the settled,
   package-wide script plus an explicit escape hatch that narrows **`test:unit`
   only**. Follow it, and report the pre-existing failures in the PR body.
   Do not "fix" unrelated suites inside this track.
   *This is no longer a founder question — it is a documented branch with one
   answer either way.*
8. **If satisfying `no-provenance` would require inventing an `asOf`** for any
   code path — stop. Fabricating a timestamp to pass your own honesty gate is
   the exact defect this track exists to kill. A path with no real `asOf` must
   report `freshness: 'unavailable'` and a typed zero.
9. **If `contracts/platform/` turns out to be the wrong home for the gate
   contract** (e.g. an architect prefers duplicating the rule, or moving
   `reply-check` wholesale into a shared package) — stop. That is a founder /
   architect call; the recommendation here is: shreai
   `shre-rapidrms/contracts/platform/` stays source of truth, aros vendors with
   checksums, per the existing precedent.
10. **If any evidence you are about to surface contains a row key you did not
    take from the declared candidate arrays** at `connectors/data-service.ts:100-115`
    — stop. That is the PCI boundary. Key names and counts only; never values,
    never a raw row, never in a log.
11. **No step in this track authenticates. If you find yourself needing a
    credential, you have left the track.** T6 and T7a are deliberately
    bearer-less; T7b is offline; T7c is the founder's, not yours. The stored eval
    password returns 401 (`2026-07-24T00:17:28Z`), `src/server.ts:1176-1189`
    escalates the lockout on repeat failures, and the account is the founder's own
    production login — which they cannot currently get into, so a lockout is not
    recoverable by them either. **BLOCKING QUESTION for the founder:** should T7c
    ever run, and against which account? *Recommendation:* do not re-set
    `npatel@rapidrms.com`'s password for a test harness — create the dedicated
    `eval@` member `scripts/chat-eval/README.md:84-85` already recommends, store it
    in OpenBao (track E, Stop conditions Q3/Q4), and let T7a+T7b be the merge gate
    for this track regardless. They cover the two claims that matter and neither
    can lock anyone out.
