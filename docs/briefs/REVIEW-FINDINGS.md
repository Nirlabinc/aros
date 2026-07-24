# Adversarial cross-check findings (3 lenses, 2026-07-24)

Produced by the review pass over all nine briefs. **The package is NOT
handoff-ready until the SEVERE and HIGH items are resolved.** Constraints lens
came back clean.

## Lens: collision
## Verdict: NOT clean on the collision lens. 12 findings, all verified against `origin/main` @ `9b4a693` in the worktree.

Cross-reference map (verified by grep over all nine briefs): **only B and H name any sibling brief.** A, C, D, E, F, G, I are package-blind — they warn about \"other tracks\" generically but never name one. That is the root cause of most of what follows.

---

### 1. SEVERE — `public.entity_note`: two different DDLs, both `IF NOT EXISTS`, and H asserts they are identical (they are not)

**Briefs:** `g-item-profile-plugin.md` §Data contract (migration, lines 594–606) and `h-customer-profile-plugin.md` §Data contract (lines 753–767) + §Collision warnings line 1248.

H's collision table states: *\"`public.entity_note` DDL — **Identical text in both briefs, `CREATE TABLE IF NOT EXISTS`.** Whichever migration lands first creates it; the second is a no-op.\"* **That claim is false.** Diffed:

| | G (`20260724_item_profile.sql`) | H (`20260724_customer_profile.sql`) |
|---|---|---|
| `entity_type` | `text NOT NULL CHECK (entity_type IN ('product'))` | **absent** |
| `entity_key` | `text NOT NULL` | **absent** |
| `canonical_id` | nullable, `ON DELETE SET NULL` | **`NOT NULL`**, `ON DELETE CASCADE` |
| `body` check | `length(body) <= 2000` | `char_length(body) BETWEEN 1 AND 2000` |
| `created_by` | bare `uuid` | `uuid REFERENCES auth.users(id)` |
| unique / index | `UNIQUE (tenant_id, entity_type, entity_key)` | no unique; `idx_entity_note_canon` |

Because both are `IF NOT EXISTS`, the second migration is a **silent no-op** and the second track's writes fail at runtime, not at migration time. If G lands first, H's insert `(tenant_id, canonical_id, body)` violates `entity_type NOT NULL`. If H lands first, G's insert references columns that do not exist and G's `UNIQUE (tenant_id, entity_type, entity_key)` upsert target is missing. H's own Stop condition Q11 covers this — but its collision table tells the executor the check has already been done, so nobody will run it.

**Fix:** reconcile to one DDL *before either merges*. Either a superset (`entity_type text NOT NULL DEFAULT 'product'`, `entity_key text`, `canonical_id` nullable, one `UNIQUE (tenant_id, entity_type, entity_key)` with `entity_key` derived from `canonical_id` for customers) owned by whichever lands first, or two tables (`item_note` / `customer_note`). Delete the \"identical text\" claim from H line 1248 and replace it with the diff above.

---

### 2. SEVERE — Track C's step 10 deletes the exact phrases Track F's headline detector depends on

**Briefs:** `c-honest-data-contract.md` §Implementation step 10; `f-real-transcript-eval.md` §Verified ground truth (`core.mjs:4-13`) and Acceptance test A.4.

C step 10: *\"Delete the divergent `ERROR_PHRASES` (`:4-13`) and rewrite `hasErrorPhrase` (`:39-42`) to read `errorLeakPhrases` from the vendored `contracts/platform/reply-check.v1.json`.\"*

Verified in the worktree — `scripts/chat-eval/core.mjs:4-13` holds 8 phrases including `'unable to retrieve'`, `'try again later'`, `'an error occurred'`, `'something went wrong'`, `'contact an administrator'`. Verified via `git show origin/main:shre-router/src/reply-check.ts` — `ERROR_LEAK_PHRASES` holds 10 phrases and contains **none of those five**. C's own ground truth #32 documents this divergence, and C's proposed `reply-check.v1.json` copies only the router's 10.

F's aros#168 lane, and its acceptance test A.4, grade this verbatim production string: *\"…Please try again later or contact an administrator for assistance.\"* → expected `verdict: 'fail'`, reason `tool-error`. After C step 10 that string scores **pass**. C's `no-provenance` rule does not compensate — that reply carries no figure.

~~**Fix:** `errorLeakPhrases` in `reply-check.v1.json` must be the **union (18 phrases)**, not the router's 10. Say so explicitly in C step 6 (\"Do not touch `ERROR_LEAK_PHRASES` semantics — same 10 entries\" must become \"widen to the union\"), and add F's #168 string to `reply-check.v1.cases.json` as a conformance case so the regression is impossible to merge.~~

**✅ RESOLVED 2026-07-24 — by DECOUPLING, not by widening. The struck-through fix above is SUPERSEDED; do not execute it.** Widening the list re-creates the very C↔F coupling this finding is about, and pushes wording rules into a contract C owns. As built: **F no longer detects tool failures on wording at all.** F's aros#168 detector is `classifyFailure()` over the typed columns `error_code` / `zero_type` / `self_check` / `http_status` (F §Data contract §3a); *\"no rule in this track may match on reply wording\"* is a hard constraint in F's ground truth; and F carries a test that the #168 wording with clean typed fields does **not** fail. **C therefore deletes `ERROR_PHRASES` as written and keeps the router's 10 entries verbatim** — C step 6 and non-goal 8 (\"same 10 strings, same order\") stand, and C step 10 carries the boxed note *\"do not widen `errorLeakPhrases` to a union to compensate. Delete the list as written.\"* The obligation lands on **C**, not F: every reply the four AROS handlers emit must carry `_shre.selfCheck` (`[]` when clean, present not omitted) and, on any data path, `_shre.dataSource.zero`, or the turn is invisible to the nightly grader. See `README.md` § Blocking corrections row 2 — the authoritative statement.

---

### 3. SEVERE — Track F's stated hard dependency on A is not satisfiable as both briefs are written

**Briefs:** `f-real-transcript-eval.md` §Data contract 1 (\"Required FROM track A\") and §2 (`20260724_chat_grades.sql`); `a-conversation-persistence.md` §4.1.

Three concrete mismatches:

- **`from_cache`** — F marks it *\"**Blocking for tier 2.** Without it, grounding stats are silently corrupted\"*. A's `chat_message` does not have it. Nothing in A captures the router's `X-Cache: HIT` header or `from_cache: true` delta.
- **`trace_id`** — F: *\"the only durable join key back to shre-router's `/v1/chat-traces`… must be captured at write time or the evidence is unrecoverable\"* (2h TTL). A's `chat_message` does not have it; A's `shre jsonb` is unindexed forensics, not a declared join key.
- **FK target + lexical ordering** — F's SQL FKs `public.chat_turns(id)`; A's table is `public.chat_message`. And F's collision table says *\"Track A's migration must sort before `20260724_chat_grades.sql`\"* — A's file is `20260724_chat_transcripts.sql`, which sorts **after** `chat_grades` (`g` < `t`). As written, a fresh apply fails on an unresolvable FK.

A's brief never mentions F's column ask; it only says F \"cannot score real transcripts until `chat_message` exists\".

**Fix:** add `from_cache boolean NOT NULL DEFAULT false` and `trace_id text` to A's `chat_message` in §4.1 (both are captured at the same seam A already hooks), and have A's `extractShre` populate them. Rename F's file `20260725_chat_grades.sql` and point the FK at `public.chat_message(id)`.

---

### 4. SEVERE — B and D both own `apps/web/src/aros-ai/actions.ts`, and D ships two tests that B will break

**Briefs:** `d-actionable-errors.md` §Data contract 1–2, Acceptance test §1 (`actions.test.ts`, `truncateParity.test.ts`); `b-auth-401-recovery.md` §Data contract C4/C5.

B handles this correctly and at length (\"one file, one union\"). **D does not name B anywhere** and ships two assertions that B makes false:

- D's `src/chat/__tests__/truncateParity.test.ts`: *\"assert `CHAT_ACTION_TYPES` in `src/chat/actions.ts` deep-equals the one in `apps/web/src/aros-ai/actions.ts`.\"* B adds four **client-only** types (`reauth`, `switch_workspace`, `retry_turn`, `open_wallet`) and states *\"the server never sends them\"* — so the client union is deliberately a strict superset. Deep-equal fails the moment B lands.
- D's `actions.test.ts` link-validity case: *\"for every `t` in `CHAT_ACTION_TYPES`, `actionPath(t)` is either `null` or a key of `PATH_TO_SECTION`.\"* B's presentation table sets `reauth → path: '/login'`. Verified in `apps/web/src/redesign/routes.ts:8-22`: `/wallet` **is** a key; **`/login` is not** (it is a top-level page outside the shell, like `/connect`). Test fails.

**Fix:** D's parity test must assert `CHAT_ACTION_TYPES` (server) ⊆ client union, not equality. Either B changes `reauth` to `path: null` + a callback (consistent with `connect_store`/`switch_workspace`), or D's link rule is widened to \"a key of `PATH_TO_SECTION` **or** a `KNOWN_PREFIXES` entry in `App.tsx:38`\". Whoever lands first must record the choice in `actions.ts`.

---

### 5. HIGH — Four tracks rewrite the same 9-line `/v1/chat` dispatch block; the declared order contradicts itself

The block (verified, `src/server.ts:6783-6792`) is edited by:

- **A** step 6 — wraps *all four* handlers in a `captureJsonResponse` shim; its code snippet hard-codes exactly the four handlers on main.
- **D** step 6 — inserts a **fifth** handler (`handleArosConnectorHealthChat`) between ping and automation, plus a `chatDeps` const.
- **C** step 3 — routes *every* reply in those handlers through a new `arosChatJson()`; its reviewable criterion is *\"`grep -n \"json(res, 200\" src/server.ts` shows no direct call inside lines ~4200-4930.\"*
- **I** Slice B — adds an `exceptions` branch inside `handleArosStoreDataChat` returning a raw `json(res, 200, …)` with a void **count and amount**.

C declares itself a hard predecessor: *\"Blocks / must be sequenced before: **any track that changes what the four AROS deterministic chat handlers emit**.\"* Neither D nor I knows C exists (I says outright: *\"I could not see other tracks' slugs from this worktree\"*). So D's fifth handler and I's new branch both emit un-gated, provenance-free replies and both break C's stated review criterion. A's shim, if it lands after D, silently drops D's handler on merge; if it lands before, D must re-derive the wrapper.

**Fix:** publish an explicit merge order for this block and put it in each brief: **C → D → I → A**. C first (establishes `arosChatJson`); D and I must emit through it (D's `deps.json` becomes `deps.arosChatJson`, and I's exception reply carries a `Provenance` since it prints money); A last, wrapping whatever chain exists rather than the four-handler snippet.

---

### 6. HIGH — `scripts/chat-eval/{core,triage-core,triage}.mjs` edited by three tracks with no stated sequence

- **C** step 10 → `core.mjs` (`hasErrorPhrase`, `scoreReply`, hard-fail list at `:105`).
- **F** steps 3, 4, 5 → `core.mjs` (`expectSubstance`, `partial-answer` at `:105`), `triage-core.mjs` (`ENGINEERING_FAMILIES`), `triage.mjs` (`FAMILY_UMBRELLA` rewrite after `planIssueActions` at `:61`).
- **E** steps 1, 3, 4 → `triage-core.mjs` (adds `classifyRun`/`runErrorIntent`/`digestText`), `triage.mjs` (rewrites line 36, wraps lines 54–79 and 82–98 in try/catch, replaces `issues` with `allIntents` at the `planIssueActions` call).

E and F both restructure the **same issue-lane region of `triage.mjs`** — E replaces the argument to `planIssueActions`, F post-processes its return value at the same call site. A's non-goal #8 says \"Track F owns those\"; C's collision #4 names only \"the chat-eval harness track (aros#130)\"; F's table names only its own steps 3/4; E's table says \"whichever track improves triage output\". **No brief names another.** Three tracks, one file, three independent claims of ownership.

**Fix:** single owner for `scripts/chat-eval/` per file, with a stated order: **E (triage.mjs/triage-core.mjs structural) → F (families + umbrella) → C (error-phrase contract in core.mjs)**. C's step 10 must be gated on F's steps 3/4 having landed, since both edit `core.mjs:105`.

---

### 7. HIGH — `ArosChat.tsx` is unmounted dead code; Track A builds its keystone on it, and three briefs give contradictory orders for the same file

Verified: `grep -rn \"ArosChat\" apps/web/src` returns the declaration at `ArosChat.tsx:41` and four **comment-only** references. There is no import, no JSX usage. The mounted concierge is `ConciergeChat` (`AppShell.tsx:3, :240`).

- **B** non-goal 5: *\"It is unmounted dead code… Leave it exactly as it is.\"*
- **D** §S + step 7f: modify it — add `actions`, `buildChatActions`, `window.location.assign(...)`.
- **A** §9 calls it *\"ArosChat (in-app widget)\"*, step 9 adds a `conversationIdRef` and a `DELETE /api/chat/conversations/:id` on `clearChat`, and **acceptance test E — the one A calls \"the only test that proves the keystone\" — begins \"Sign in in a browser at https://app.aros.live and open the AROS chat widget\"** and expects `surface: \"aros-chat\"`. That test cannot be executed.

Knock-on for A's schema: A's `surface` CHECK is `('aros-chat','concierge','start-chat','api','unknown')`. `aros-chat` is unreachable (dead component); `start-chat` is unreachable because A's non-goal 2 drops anonymous turns and `StartChat.tsx:131` sends no `Authorization` header (verified). In practice only `concierge` is ever written.

**Fix:** A's §9 must record ArosChat as unmounted, drop step 9's ArosChat half, and rewrite acceptance test E to drive `/chat` (ConciergeChat). Resolve B-vs-D on the file: if D's step 7f stands, B's non-goal 5 must be amended to \"B does not touch it; D does.\"

---

### 8. HIGH — Three briefs each invent their own PAN redactor, with divergent semantics

- **A** §4.2 — `redactPan()` in `src/chat/transcript.ts`, **Luhn-gated**, with an explicit negative test that `'2026072420260724'` (16 digits, Luhn-invalid) comes back byte-identical.
- **D** §Data contract 6 — `redactUpstreamError()` in `src/chat/redact.ts`, *\"Any run of **13–19 digits**… → `[redacted]`\"*, **no Luhn check** — it would redact A's negative-test fixture.
- **F** §Data contract 3 — `redactPii()` in `scripts/chat-eval/transcript-core.mjs`, PAN rule first, 13–19 digits.

All three assert the repo has no such helper (A: *\"There is no PAN redaction helper in this repo. You must write one.\"*; D: same conclusion). Verified true today — but the package produces three, and two of them disagree about what a PAN is. That is exactly \"two briefs inventing the same abstraction separately,\" on the one rule the house calls non-negotiable.

**Fix:** one owner — `src/chat/redact.ts` exports `redactPan` (Luhn-gated, A's semantics, since A has the sharper negative-test suite); A imports it instead of declaring it; D's `redactUpstreamError` composes it rather than re-implementing a digit rule. F mirrors it across the `.ts`/`.mjs` boundary with a drift note and a shared fixture list — the exact pattern D already uses for `truncateText`.

**✅ RESOLVED 2026-07-24.** Normative spec in `d-actionable-errors.md` §Data contract **6a** (signature, candidate regex `/(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g`, Luhn gate, marker, totality, idempotence) + shared fixture file `src/chat/__fixtures__/pan-redaction.json` (every entry's Luhn validity computed, not assumed). D §6b composes it, its bare digit rule deleted; A §4.2 imports it and its tests 1–3 drive off the fixture file; F mirrors it in `.mjs` with parity test 10b on the same file; G and H consume it for owner-typed `entity_note.body`. All four state "whoever lands first creates the file; the second imports."

---

### 9. HIGH — No brief binds to the `ai-activity-spine` actor-stamp contract, which COORDINATION declares a stop condition

**Brief:** `COORDINATION-ai-activity-spine.md` §\"Who owns what\" vs `a-conversation-persistence.md` (whole).

COORDINATION: *\"**Track A (conversation persistence) is the AROS half of that spine.** It must BIND to the spine's actor-stamp contract, not invent a second one. Treat this with the same force as the standing rule against forking `canonical_entity`: a second attribution path is a stop condition, not a design choice.\"* And: *\"Centrix is **the reference shape, not a gap**: `server/ai-executor.ts:58–134`… Track A should start from that shape and justify any divergence explicitly. **Do not design the AROS schema from scratch.**\"*

Grep confirms A contains **zero** references to `ai-activity-spine`, the mission contract, Centrix, or an actor stamp. It designs `chat_conversation`/`chat_message` from scratch from AROS-local precedent only. F, which inherits A's attribution model, is equally silent — and COORDINATION explicitly warns F *\"inherits a second incompatible attribution model if [A] does not [bind correctly].\"*

**Fix:** A gains a \"Bind to the AI activity spine\" subsection before step 1, citing `shre-dev-kit/docs/missions/ai-activity-spine.md` (branch `feat/ai-activity-spine-mission`, `4dbc058`/`8f20058`) and Centrix `server/ai-executor.ts:58-134` / `logAction:808`, with a column-by-column justification for each divergence. This is a stop condition, so it belongs above the migration, not in a collision note.

**✅ RESOLVED 2026-07-24.** The mission contract was read first-hand (`git show feat/ai-activity-spine-mission:docs/missions/ai-activity-spine.md` — never checked out) rather than paraphrased: its envelope is `product`, `event_type`, `actor_user_id`, `actor_id_source`, `workspace_id`, `trace_id`, `outcome` + cost columns; increment 1 is shipped; **increment 5 is "AROS emitter — attribution must be created, nothing persisted today"**, i.e. this track. A now carries a top-level "Bind to the AI activity spine — STOP CONDITION, read before step 1" section before § Data contract, with a column-by-column binding table (`tenant_id` ≡ `workspace_id`, `user_id` ≡ `actor_user_id`, `trace_id` ≡ `trace_id`, `actor_id_source` → `meta` with the reason, `product`/`event_type`/`outcome` derived, cost columns deliberately absent because `cost_events` is empty), migration INVARIANT 4 (actor stamp, NOT NULL + FK on every row) and INVARIANT 5 (append-only per-message rows; Centrix's blob + 30-min TTL adopted for attribution only, rejected for persistence), a new Step 0 gate, and a single flag-off `CHAT_ACTIVITY_EMIT` emit seam. F records the inherited attribution and storage shape in its § Data contract; G and H record the same one-path rule. **Open founder decision — recorded, not invented: A § Stop conditions Q7**, ship the emitter (increment 5) or stop at the actor stamp. Recommendation: stop at the actor stamp + flag-off seam, since the emit target depends on the concurrent session's unresolved shre-meter-runtime decision.

---

### 10. MEDIUM — Track A's 90-day purge silently destroys Track F's grading ledger

A §4.1 ships `purge_expired_chat_transcripts()` hard-deleting `chat_message` at `expires_at` (default 90 days). F's `chat_grades.turn_id … ON DELETE CASCADE` was chosen for GDPR erasure — but it also means A's *routine* nightly purge wipes the entire quality-trend history on a 90-day rolling window. Neither brief mentions the interaction; F's rollback and README sections assume grades accumulate.

**Fix:** decide explicitly. Either `chat_grades.turn_id` becomes `ON DELETE SET NULL` with `tenant_id` + `business_date` retained (grades survive, no text ever existed there anyway), or F documents the 90-day horizon as a product decision and A's `CHAT_RETENTION_DAYS` becomes a founder-ratified input to both briefs, not just A's.

---

### 11. MEDIUM — H claims a mutual `STRONG_KEYS` conflict with G that does not exist, masking a unilateral edit to the merged golden-record layer

**Brief:** `h-customer-profile-plugin.md` §Collision warnings line 1250: *\"`src/golden/resolve.ts:55-59` `STRONG_KEYS` | Item Profile touches the `product` line, this track touches the `customer` line. **Two one-line edits to adjacent lines — near-certain textual conflict.** Coordinate: land one, rebase the other.\"*

Verified: G touches **no file under `src/golden/`**. G §Non-goals: *\"`src/golden/*` — bind to it, do not extend or alter it,\"* and G's Decision 2 works entirely within the existing `product: ['upc','gtin','sku']`. Only H edits the file (line 1209: adding `'card_fp'` to `STRONG_KEYS.customer`).

The consequence is not a merge conflict — it is that H is the **only** track in the package mutating merged golden-record code, and its brief frames that as a routine two-way rebase rather than as a decision that has to clear the package-wide \"never fork / never extend the golden-record layer\" gate.

**Fix:** delete the false row; replace with an explicit escalation: \"This track adds a key to `STRONG_KEYS.customer` in the merged golden layer — founder ratification required before step 1, per the standing rule.\" G needs no change.

---

### 12. LOW — Track E re-declares `public.platform_settings` DDL in a second migration file

**Brief:** `e-watchdog-unsilence.md` §Data contract C5. Verified: `supabase/migrations/20260723_platform_settings.sql` already creates the table with RLS on and zero policies. E's `20260724_chat_eval_heartbeat.sql` repeats the full `CREATE TABLE IF NOT EXISTS` + `ALTER … ENABLE ROW LEVEL SECURITY` + `REVOKE` as *\"documentation-only, idempotent.\"* It is safe today, but it leaves two `CREATE TABLE` statements for one table in two files; if either is later edited the repo has two sources of truth and `check-migration-safety.mjs` will not notice.

**Fix:** keep only the header comment, the `REVOKE`, and the seed `INSERT … ON CONFLICT DO NOTHING`; drop the duplicated `CREATE TABLE` and cite `20260723_platform_settings.sql:9-15` instead.

---

### Dependency-order check

A-as-keystone holds for F (F correctly marks steps 6, 7, 9, 10 blocked on A, and 0–5, 8 unblocked) — **but the declared order is not globally satisfiable as written:**

- **B claims precedence over A** (*\"Land this track's steps 1–3 first… or expect a manual merge in `proxyRequest`\"*) while **A lists no dependency on B and never names it.**
- **C claims precedence over D and I** while **neither D nor I names C.**
- **A must land last** in the `/v1/chat` block (finding 5), but A also declares itself the keystone that starts first — those are different files (`proxyRequest` region vs the dispatch block) and the brief never distinguishes them.

A satisfiable order consistent with every brief's own constraints: **B(1–3) → C → D → I → A(migration + steps 4–11) → F(6,7,9,10)**, with E, G, H independent (G/H gated on finding 1 and on their own founder gates).

## Lens: constraints
Read all 11 files in `docs/briefs/` and verified every load-bearing claim against the worktree at `C:/Users/nirpa/.shre/worktrees/aros/chat-observability`.

**Six findings survive verification. Ranked most severe first.**

---

**1. `h-customer-profile-plugin.md` — Data contract § Migration (line 783): the `holder_fp` column protection is a documented PostgreSQL no-op. Hashed cardholder name is readable by every tenant member.**

The migration runs, in this order:
- line 779 (inside the DO-loop over `customer_card_rollup`): `EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t)`
- line 783: `REVOKE SELECT (holder_fp) ON public.customer_card_rollup FROM authenticated;`

PostgreSQL's REVOKE reference states: *\"if a role has been granted privileges on a table, then revoking the same privileges from individual columns will have no effect.\"* The table-level grant is issued first, so the column revoke does nothing (it emits a warning and leaves `SELECT` on all columns intact).

Consequence: `holder_fp` — which the same brief declares at lines 569–574 is *\"PII-equivalent at rest: RLS-protected, never in an API response, never in a log line\"* — is selectable by any active member of the tenant through PostgREST, alongside `card_brand`, `card_last4`, `visits`, `total_spend_cents`, `first_seen_at`/`last_seen_at`. That is a stable per-consumer identity token derived from the cardholder name, sitting on the owner-side surface the C3 section (lines 33–41) draws a hard boundary around. The brief's own T5 leak test (line 1113) only serialises *handler projections* — it cannot catch a direct PostgREST read, so nothing in the acceptance suite detects this.

**Fix:** do not grant `holder_fp` in the first place. Replace the loop's blanket grant for this one table with an explicit column list, e.g.
`GRANT SELECT (id, tenant_id, run_id, canonical_id, store_scope, card_brand, card_last4, visits, total_spend_cents, avg_basket_cents, first_seen_at, last_seen_at, hour_histogram, confidence, created_at) ON public.customer_card_rollup TO authenticated;`
and delete line 783. Add a negative test that asserts an authenticated JWT selecting `holder_fp` errors rather than returning rows. Better still: move `holder_fp` to a separate service-role-only sidecar table so no grant on the member-readable table can ever reach it.

**✅ RESOLVED 2026-07-24 — the sidecar was taken, not the column list.** The PostgreSQL semantics were re-verified before acting (REVOKE reference, Notes: a column-level revoke after a table-level grant has no effect), as was the claim that this repo's other migrations defend against Supabase's *default* privileges (`20260716_oidc_rp_sessions.sql:17`, `20260717_experience_routing_identity_links.sql:16,34,45`, `20260717_public_commerce.sql:96-98`, `20260717_terms_acceptances.sql:57`) — so "no explicit GRANT" is not evidence of safety here. **`public.customer_card_rollup` no longer has a `holder_fp` column.** The hash moved to a new `public.customer_card_holder_fp`: one row per **distinct** holder hash per card (which also fixes the type mismatch — `CardAggregate.holderFps` is a set, a single column could never hold it), `ENABLE ROW LEVEL SECURITY`, **no policy, no grant**, `REVOKE ALL … FROM anon, authenticated`. The no-op `REVOKE SELECT (holder_fp)` is gone, replaced by a comment quoting the rule so it is not re-added; the DO-loop comment now names the two tables that must never be added to it, and states the invariant that keeps its blanket grant safe (every column of every table in it is member-safe by construction). **Why not the column-list grant:** it works, and it is written down as the fallback, but it is one copy-paste of the standard DO-loop away from being silently undone and it re-exposes the surface on every future `ADD COLUMN`; the sidecar makes the safe state structural. New **T6b** is the acceptance test the suite was missing: an authenticated JWT selecting `holder_fp` must raise `42501` and **zero rows is an explicit FAIL**, `information_schema.columns` must show no `holder_fp` on `customer_card_rollup`, and `role_table_grants` + `column_privileges` for `anon`/`authenticated` must both be empty. **Swept the package for the same bug class: `REVOKE SELECT (holder_fp)` was the only column-level revoke in any of the eleven briefs** (`grep -rn "REVOKE" docs/briefs/`), and there are no column-level `GRANT`/`REVOKE` statements anywhere in `supabase/migrations/`.

---

**2. `g-item-profile-plugin.md` (§ Verified ground truth, \"golden-record layer\" bullet 6) — `canonical_strong_key` has no RLS, and Item Profile is the first track to write production data into it while explicitly declining to fix that.**

Verified in the repo: `supabase/migrations/20260720_golden_records.sql:110` enumerates `ARRAY['canonical_entity','entity_alias','merge_candidate','negative_pair','merge_event']`. `canonical_strong_key` (created at `:29`) appears nowhere in the RLS/GRANT/REVOKE loop, and `grep -rn \"canonical_strong_key\" supabase/migrations/` returns only the CREATE, an index, and `20260721_golden_claim_fn.sql` writes. No `ENABLE ROW LEVEL SECURITY`, no policy, no `REVOKE`.

G's own brief calls this *\"deliberately absent from that array\"* — it is not deliberate; H documents it at lines 132–153 as a live defect. And H's rationale for it being harmless today (*\"it has no `GRANT SELECT … TO authenticated`, so nothing leaks today\"*, line 146) does not hold: this repo's other migrations defend against Supabase's default privileges with explicit `REVOKE ALL … FROM anon, authenticated` (`20260716_oidc_rp_sessions.sql:17`, `20260717_experience_routing_identity_links.sql:16,34,45`, `20260717_public_commerce.sql:96-98`, `20260717_terms_acceptances.sql:57`). That defensive pattern only makes sense if defaults do grant. `canonical_strong_key` has neither RLS nor a REVOKE — it is the one golden table with no gate of any kind, and it is the table that holds `card_fp` (H) and `upc`/`sku` (G).

Worse, the sequencing is backwards: H's collision table (line 1251) advises *\"Land Item Profile first if it is ready\"*, and G Step 5.1 has `resolveCanonical` writing strong keys for every catalog row — putting production rows into an ungated table before H's fix lands.

**Fix:** move the `canonical_strong_key` RLS block (H lines 683–691) out of H's migration into its own tiny migration that lands **before either** track, and add `REVOKE ALL ON public.canonical_strong_key FROM anon, authenticated;` alongside the `ENABLE ROW LEVEL SECURITY`. Both G and H then depend on it. G's ground-truth bullet must be corrected from \"deliberately absent\" to \"a defect, fixed by migration X\".

**✅ RESOLVED 2026-07-24.** The fix is `supabase/migrations/20260724_canonical_strong_key_rls.sql`, **owned by G** (its § Shared migration), carrying `ENABLE ROW LEVEL SECURITY`, the `canonical_strong_key_sel_member` policy, **and** `REVOKE ALL ON public.canonical_strong_key FROM anon, authenticated;`. Same single-owner pattern as `entity_note`: own file, one declaration, sorts first — applied order `20260724_canonical_strong_key_rls.sql` → `20260724_entity_note.sql` → `20260724_item_profile.sql` → `20260725_customer_profile.sql` (`c` < `e` < `i`, then the later date). H's block (0) is deleted and replaced with a "declared elsewhere, do not re-add" comment; H Step 2 gained the same fetch-check-or-copy-byte-identically procedure it already uses for `entity_note`, and H's shared-artefact row no longer says "idempotent, safe in either order" — that framing is what let the sequencing stay backwards. **The gate-ordering hazard is closed at the root:** the file is explicitly carved out of G's journey-spec founder gate (it creates no table and ships no feature, so a feature gate cannot hold a security fix), and G Step 5.1 — the `resolveCanonical` call that writes a strong key for **every** catalog row — now carries a hard precondition that the migration be applied first, with Q4 as the stop. G's ground-truth bullet is rewritten: "deliberately absent" → "a live defect", with the four `REVOKE ALL` precedents cited inline and the "no GRANT, so nothing leaks" argument refuted in both G and H. **Verified, not assumed:** `scripts/check-migration-safety.mjs:24-25` `readFileSync`s every `*.sql` and `.join('\n')`s them into one string before matching, so it genuinely cannot distinguish one declaration from two — hence the merge gate `grep -rln "ALTER TABLE public.canonical_strong_key ENABLE ROW LEVEL SECURITY" supabase/migrations/ \| wc -l` = `1` in both briefs; its RLS rule also only ever passed on this table because of the 4,000-character proximity regex at `:37-38`, and its REVOKE rule (`:50-62`) covers **views only**, so no lint can enforce the table REVOKE. Tests were adjusted to match the new posture rather than left to pass vacuously: with `REVOKE ALL` in force a member's `SELECT` must **error**, not return zero rows, so G acceptance E gains a negative privilege assertion (`42501`; zero rows is a FAIL) and H moves the table out of T6's zero-row loop into T6b.

---

**3. `g-item-profile-plugin.md` § Migration vs `h-customer-profile-plugin.md` § Migration — the shared `public.entity_note` DDL is materially different in the two briefs, and both use `CREATE TABLE IF NOT EXISTS`, so the divergence lands silently and breaks whichever track merges second.**

H asserts at line 1248: *\"Identical text in both briefs, `CREATE TABLE IF NOT EXISTS`. … If the DDL differs by even one column, **STOP**.\"* They differ substantially:

| | G (lines 595–606) | H (lines 755–764) |
|---|---|---|
| `entity_type` | `text NOT NULL CHECK (entity_type IN ('product'))` | absent |
| `entity_key` | `text NOT NULL` | absent |
| `canonical_id` | nullable, `ON DELETE SET NULL` | `NOT NULL`, `ON DELETE CASCADE` |
| `created_by` | `uuid`, no FK | `uuid REFERENCES auth.users(id)` |
| body check | `length(body) <= 2000` | `char_length(body) BETWEEN 1 AND 2000` |
| unique | `UNIQUE (tenant_id, entity_type, entity_key)` | none |

Because both are `IF NOT EXISTS`, the second migration silently no-ops — no error, no lint failure, `check-migration-safety.mjs` passes either way. If G lands first, H's note insert fails at runtime on `entity_type`/`entity_key` NOT NULL, and G's `CHECK (entity_type IN ('product'))` rejects customer notes outright. If H lands first, G's insert fails on `canonical_id NOT NULL` and on columns that do not exist.

**Fix:** pick one DDL now and paste it byte-identically into both briefs — G's shape (`entity_type` + `entity_key`, nullable `canonical_id`) is the superset, with the CHECK widened to `('product','customer')`. Or extract `entity_note` into its own migration that both tracks depend on. Additionally, replace `CREATE TABLE IF NOT EXISTS` with a form that fails loudly on divergence, or add a column-presence assertion to each track's acceptance tests — a silent no-op is the wrong failure mode for a table two tracks share.

---

**4. `b-auth-401-recovery.md` C4 (lines 600–606) vs `d-actionable-errors.md` Acceptance tests §1 (line 1136) — the two tracks share one mandated `CHAT_ACTION_PRESENTATION` record, and B's `reauth` row fails D's link-validity invariant.**

D's test, which it calls *\"the test that makes a dead link impossible to merge\"*: for every `t` in `CHAT_ACTION_TYPES`, `actionPath(t)` must be `null` or **a key of `PATH_TO_SECTION`**. B contributes `reauth → { label: 'Sign in again', path: '/login' }`.

Verified in `apps/web/src/redesign/routes.ts:8-22`: `PATH_TO_SECTION` has no `/login` key. (`/wallet` and `/connection-health` are present, so B's other three rows are fine.) `/login` is a top-level page outside the shell, exactly like `/connect`, which D's ground truth M correctly calls out as *\"not in `PATH_TO_SECTION`\"*.

Both briefs mandate one file, one union, no parallel type (B lines 669–671; D lines 461–468). So whichever lands second either breaks D's test or has to weaken the invariant that stops dead links from merging.

**Fix:** give B's `reauth` `path: null` and route it through a callback, exactly as B already specifies for `switch_workspace` and `retry_turn` — Step 7e (lines 984–990) already requires `reauth` to persist the transcript and then navigate, i.e. it is a callback, not a plain link. Then D's invariant holds unchanged for all eight types.

**✅ RESOLVED — re-confirmed 2026-07-24.** B and D now agree on **one** definition with **one owner**, and the fix landed exactly as recommended. Verified in both briefs: D **creates and owns** `apps/web/src/aros-ai/actions.ts` — `ChatActionType`, `CHAT_ACTION_TYPES`, `CLIENT_ONLY_ACTION_TYPES` (shipped empty), `CHAT_ACTION_PRESENTATION`, `buildChatActions`, `actionPath` (`d-actionable-errors.md` § Data contract 2 and its file-ownership row); B **extends** the union, appends its four types to `CLIENT_ONLY_ACTION_TYPES`, and adds four presentation rows (`b-auth-401-recovery.md` C4 and its two ownership rows). Merge order `D → B(client steps 4–8)` is stated in both, and both say "never a parallel type, never a second file". B's `reauth` row is `path: null` in **both** briefs, with B carrying an explicit `CORRECTED 2026-07-24 — reauth is path: null, NOT path: '/login'` note citing `apps/web/src/redesign/routes.ts:8-22`, and D's acceptance §1 restating the same correction next to its "the test that makes a dead link impossible to merge" invariant. `switch_workspace` and `retry_turn` are `path: null` too; `open_wallet` → `/wallet` and D's four server types → `/connection-health` / `/stores` are keys of `PATH_TO_SECTION`. No change needed on this pass.

---

**5. `a-conversation-persistence.md` — the brief never binds to the AI activity spine actor-stamp contract, which `COORDINATION-ai-activity-spine.md` declares a stop condition with the same force as forking `canonical_entity`.**

`COORDINATION-ai-activity-spine.md:20-31` states: *\"Track A (conversation persistence) is the AROS half of that spine. It must BIND to the spine's actor-stamp contract, not invent a second one. Treat this with the same force as the standing rule against forking `canonical_entity`: a second attribution path is a stop condition, not a design choice.\"* It further names `server/ai-executor.ts:58–134` + `logAction` (`:808`) as *\"the reference shape, not a gap\"* and says *\"Do not design the AROS schema from scratch.\"*

Grepped brief A for `spine`, `actor.stamp`, `COORDINATION`, `Centrix`, `aiConversations`, `ai_activity` — **zero hits**. Its §14 (line 468) faithfully covers the golden-record rule but is silent on the spine. §4.1 designs `chat_message`'s attribution columns (`model`, `mode`, `agent_id`, `tools_used`, `shre` jsonb) from scratch, and its Non-goals (lines 1053–1065) never mention the concurrent mission. Track F then inherits whatever A picks (COORDINATION line 76–78).

**Fix:** add a §16 to brief A that reads `shre-dev-kit/docs/missions/ai-activity-spine.md` on branch `feat/ai-activity-spine-mission` (commits `4dbc058`, `8f20058`), maps its actor-stamp fields onto `chat_message`, and justifies any divergence explicitly — plus a Stop condition mirroring the golden-record one. Also add the spine mission to A's \"Depends on / blocks\" and to the Collision warnings, since both missions are live in the same repo at the same time.

---

**6. (partially mitigated) `f-real-transcript-eval.md` Data contract §1 and §2 vs `a-conversation-persistence.md` §4.1 — F's tier-2 grading asks for three things A's schema does not provide, and A's brief does not know it was asked.**

F requires `from_cache boolean` (marked **\"Blocking for tier 2 … Without it, grounding stats are silently corrupted\"**, line 395), `trace_id text`, and FKs to `public.chat_turns(id)` (line 428). Track A creates `chat_conversation` + `chat_message` with `seq`, and has no `from_cache` and no `trace_id` column. Tier 2 is the tier that produces `ground-truth-mismatch` verdicts from numbers — and the router's response-cache key has no tenant component (`response-cache.ts:74`), so an ungated cached reply can be graded as this tenant's answer when it was generated for another.

F does flag all of this in its Stop conditions 1 and 8, which is why this ranks last. But the negotiation window belongs to A (it ships first, by hand, into a prod Supabase that has drifted before — A's Collision warning 6), and A's brief carries no reciprocal ask.

**Fix:** add `from_cache boolean NOT NULL DEFAULT false` and `trace_id text` to A's `chat_message` DDL in §4.1 now — both are cheap, additive, and unblock F without a second migration against a hand-applied prod schema. Correct F's `public.chat_turns(id)` to `public.chat_message(id)` once A's names are fixed.

---

## Clean on this lens

Verified and found no violation of the hard constraints:

- **PAN.** No brief stores, logs, displays or returns one. A §4.2 mandates a Luhn-checked `redactPan` before insert with explicit false-positive tests; C §4.1 constrains evidence strings to elements of the declared candidate arrays with a PCI negative test; D §6 puts the 13–19-digit rule first in the redactor; F `redactPii` rule 1 is PAN-first; H normalises to last-4 only with a `CHECK (card_last4 ~ '^[0-9]{4}$')` and a live-probed zero-PAN verdict plus a `pan_risk_rows > 0` hard stop; G and I forbid touching `invoicePaymentDetail` at all.
- **RLS in the same migration.** Every table any brief *creates* has `ENABLE ROW LEVEL SECURITY` in the same file (A `chat_conversation`/`chat_message`; F `chat_grades`; G six tables; H four tables; E re-asserts on `platform_settings`). B, C, D, I add no migration and say so. The only RLS gap was the pre-existing `canonical_strong_key` — finding 2, now closed by G's `20260724_canonical_strong_key_rls.sql`. (H's count is now five tables: the three in its member-select loop, plus the `holder_fp` sidecar `customer_card_holder_fp` from finding 1, which is RLS-on / no-policy / no-grant / `REVOKE ALL`, plus `entity_note` which it consumes but does not declare.)
- **Second identity path.** None. G binds through `resolveCanonical` with a one-key-per-item rule and a `merge_candidate`-flood regression test; H's only resolver change is adding `'card_fp'` to `STRONG_KEYS.customer`; A §14, B, C, D, E, F, I each carry an explicit no-fork stop condition.
- **Numbers without a verified data contract.** This is the package's strongest axis. C's whole design is the typed-zero ladder; G withholds guidance below 14 days / 2 sale days rather than printing a zero and forbids copying the fake `edi-invoices` `SECTIONS` rows; D forbids `human-layer.ts`'s fabricated `N/N connectors active`; H gates every figure behind a re-run kill criterion and Q5/Q7; I refuses three Phase-4 triggers on probed absence of source fields.
- **Functional core / imperative shell.** Every brief separates a pure module from a thin shell with a named reviewer grep (`src/chat/transcript.ts`, `src/authFailure.ts` + `chatRecoveryLogic.ts`, `src/chat/freshness.ts`, `src/chat/connectorActions.ts` + `truncate.ts`, `triage-core.mjs` `classifyRun`, `transcript-core.mjs`, `src/items/*`, `src/customers/*`, `src/chat/exception-intent.ts`). Clocks and salts are injected as arguments throughout.
- **Zero horizontal page scroll, 320–1440px.** Asserted with a real `scrollWidth <= clientWidth` E2E check in every brief that ships UI (D §3.7 incl. landscape, G §G.5, H T10.3 incl. landscape; A step 8 requires the table in its own `overflow-x:auto` container). E §7 and F §9 waive it explicitly with the correct justification (no surface) rather than claiming untested compliance.

## Lens: executability
Read all 11 files and verified every load-bearing anchor against the worktree (`origin/main` @ `9b4a693`). The factual grounding is genuinely strong — I spot-checked ~30 `path:line` anchors across A/B/C/E/I (`src/server.ts` 7214 lines; `:4156 chatLatestText`, `:4174 arosChatTenant`, `:4209/:4232/:4632/:4844` handlers, `:6783 /v1/chat`, `:2559 authenticateRequest`, `:980-1004` missing-else, `authenticateRequest(` count = 60, `nyBusinessDate(daysAgo=0)` at `:4145`, `pickStr` at `:73`, `triage.mjs:35/36/50/57`, `App.tsx:112/120/161/166/193`, migration count 36 → `check:migrations` green) and **every one was exact**. The findings below are executability, not accuracy.

---

## 1. Brief A references a \"Stop conditions\" section that does not exist (also B, E, I)
**`a-conversation-persistence.md`** cites \"see Stop conditions\" three times — line 46 (verify prod has no out-of-band `chat%` table *before* step 1), line 643 (**\"90 days is a proposal requiring founder ratification — see Stop conditions\"**), line 833 (**\"If `authResolved` is false for the ArosChat surface, STOP** and go to Stop conditions\"). The file's sections are Track / Verified ground truth / Depends / Data contract / Implementation steps / Acceptance tests / Non-goals / Collision warnings / Rollback. **No such section.** Same dangling reference in `b-auth-401-recovery.md:1144`, `e-watchdog-unsilence.md:380, 601, 939`, `i-alerts-register-exceptions.md:129, 262, 911`. C, D, F, H all have the section; A, B, E, I don't.

This is the worst one because it is exactly where the founder-only decisions are supposed to live. A zero-context Codex hits \"STOP and go to Stop conditions\", finds nothing, and does the reasonable thing: keeps going with a 90-day PII retention default nobody ratified.

**Fix:** add the section to A, B, E, I. A's must contain at minimum: the 90-day retention ratification, the canary-fails-for-ArosChat branch, and the pre-step-1 prod table check. E's must contain the OpenBao KV path / `.dpapi` unwrap question and the `PLATFORM_ALERT_WEBHOOK` decision.

## 2. Brief A's persistence timing contract is self-contradictory in three places
- **§4.3** (`persistTurn` contract): *\"Runs entirely **after** `res.end()` has been called. It adds **0 ms** to time-to-first-byte.\"*
- **Step 6**, code block: `const finish = () => { void afterChatTurn(...) }` called *after* `handleArosSalesChat(req, capture.res, body)` has already `json(res, …)`'d — i.e. after end. Point 1 of `afterChatTurn`: *\"Return immediately (do not `await`).\"*
- **Step 6 point 8**: *\"Inject `_shre.conversationId` into the buffered response **before** it is flushed … the capture shim must hold the final chunk until the conversation id is known … bounded at 250 ms.\"*

You cannot both run entirely after `res.end()` and hold the flush until an id resolved by a Supabase insert. A zero-context executor picks one and silently ships either (a) no `conversationId` on the wire — which breaks step 9's client echo, acceptance E steps 2–3, and the whole threading story — or (b) a synchronous DB round-trip on the chat hot path.

**Fix:** pick one. The workable shape is: mint the conversation id **synchronously and locally** (`crypto.randomUUID()`) before the handlers run, inject it into the buffer with zero I/O, and let `persistTurn` insert the row with that pre-minted id after `res.end()`. Then §4.3's \"0 ms\" is true and step 6.8's 250 ms hold disappears.

## 3. Brief A's Acceptance test F is guaranteed to fail by the brief's own design
**`a-conversation-persistence.md` → Acceptance tests §F.** Budget: *\"persistence adds < 5 ms p95 to `/v1/chat` TTFB … **If the delta exceeds 5 ms, the id-resolution is on the wrong side of the flush — fix it before merging.**\"* The 50-iteration loop sends `{\"messages\":[{\"role\":\"user\",\"content\":\"say online\"}]}` with **no `conversationId`**, so per step 6.6 every one of the 50 requests mints a *new* `chat_conversation` — a Supabase insert before flush, per step 6.8. That is tens of milliseconds each, not <5 ms. The test fails while the implementation is exactly what the brief specified.

**Fix:** either adopt finding #2's pre-minted-id design (then <5 ms is real), or change the test to send a stable `conversationId` after the first request and state a separate, honest first-turn budget.

## 4. Brief A treats `apps/web/src/aros-ai/ArosChat.tsx` as the live in-app widget. It is dead code — and B says so explicitly.
Verified: `grep -rn \"ArosChat\" apps/web/src` returns the declaration at `ArosChat.tsx:41` plus **four comment mentions** (`CanvasContext.tsx:2`, `ChatMessageRenderer.tsx:16`, `chatTheme.ts:2`, `composerIcons.tsx:3`, `ConciergeChat.tsx:18`). No import, no mount. `AppShell.tsx:3,240` mounts `ConciergeChat` only.

- **A §9** lists it as \"ArosChat (in-app widget)\" — the first row of the surface table.
- **A Step 9** instructs editing it (`useRef`, request body at `:124-127`, `clearChat` at `:170`).
- **A Acceptance §E** — described as *\"the only test that proves the keystone\"* — step 1: *\"Sign in … and **open the AROS chat widget**\"*, step 4 expects `surface \"aros-chat\"`. Unrunnable: there is no such widget on the deployed surface.
- **A Step 3** gates the entire track on a canary that measures *\"does `authenticateRequest` resolve for `ArosChat` (cookie-only) requests in production?\"* — it will resolve zero ArosChat requests because zero exist, which per step 3 is a **STOP**.
- **B §10 and B Non-goal #5** state correctly: *\"**No** — grep across `apps/web/src` finds only comment references. Dead code… Leave it exactly as it is.\"*
- **D §S** puts it back in scope and **Step 7f** instructs modifying it — a direct contradiction of B's non-goal.

**Fix:** rewrite A §9/Step 9/Acceptance E around `ConciergeChat` (surface `concierge`), drop the ArosChat canary premise, and reconcile D §S/Step 7f with B Non-goal #5 — one of them is wrong and only the founder should decide whether dead code gets extended.

## 5. `entity_note` DDL is materially different between G and H, and H asserts it is identical
**`h-customer-profile-plugin.md` → Collision warnings**: *\"`public.entity_note` DDL — **Identical text in both briefs**, `CREATE TABLE IF NOT EXISTS`. Whichever migration lands first creates it; the second is a no-op.\"* They are not identical:

| | G (`20260724_item_profile.sql`) | H (`20260724_customer_profile.sql`) |
|---|---|---|
| `entity_type` | `text NOT NULL CHECK (entity_type IN ('product'))` | **absent** |
| `entity_key` | `text NOT NULL` | **absent** |
| `canonical_id` | nullable, `ON DELETE SET NULL` | **`NOT NULL`**, `ON DELETE CASCADE` |
| `body` CHECK | `length(body) <= 2000` | `char_length(body) BETWEEN 1 AND 2000` |
| `created_by` | `uuid` (no FK) | `uuid REFERENCES auth.users(id)` |
| UNIQUE | `(tenant_id, entity_type, entity_key)` | none |

`CREATE TABLE IF NOT EXISTS` means the second migration is a **silent no-op**. If G lands first (it is sequenced to — G \"blocks Phase 3\"), H's note insert (`canonical_id` + `body` only) fails on `entity_type`/`entity_key` NOT NULL — and G's `CHECK (entity_type IN ('product'))` makes a customer note *impossible* without another migration. If H lands first, G's `PUT /api/items/:key/note` fails on missing columns. **G's Collision warnings section does not mention `entity_note` or track H at all** — G's executor gets no warning whatsoever. H's Q11 only catches it if the executor read G's brief.

**Fix:** publish one agreed `entity_note` DDL in both briefs (the polymorphic `entity_type`/`entity_key` shape with `entity_type IN ('product','customer')` works for both), and add the shared-table row to G's collision table.

## 6. Track F's \"Required FROM track A\" contract does not match track A's actual schema
**`f-real-transcript-eval.md` → Data contract §1** lists columns F needs from A, two of them with severity **Blocking**:

- **`from_cache boolean NOT NULL DEFAULT false`** — *\"**Blocking for tier 2.** Without it, grounding stats are silently corrupted.\"* **Not in A's `chat_message`.** A's §4.1 has no such column and A's §4.2 `ShreEnvelope` doesn't extract it.
- **`trace_id text`** — *\"Degrades: step 9 becomes impossible.\"* Not in A's schema.
- Naming drift: F wants `turn_index`, A has `seq`. F wants `resolved_model`, A has `model`. F's migration FKs `public.chat_turns(id)`; A's table is `public.chat_message`.

F flags the table-name mismatch as a stop, but not the two missing columns — it will only surface after A's migration is applied by hand to prod (A step 2), at which point adding columns is a second hand-applied migration.

**Fix:** add `from_cache boolean NOT NULL DEFAULT false` and `trace_id text` to A's `chat_message` in §4.1 before A ships, and add an explicit \"consumed by track F\" note. A's `shre jsonb` column is not a substitute — F needs `from_cache` indexable/queryable for tier-2 exclusion.

## 7. Three briefs prescribe three different values for the same `package.json` `\"test\"` script
Verified: `package.json` has no `test` script today, and `.github/workflows/standard-ci.yml:66-80` → `scripts/test.sh:7-15` → `jq -e '.scripts.test'` not found → *\"No test script; skipping strict checks\"* → **exit 0**. All three briefs correctly diagnose this, then prescribe incompatible fixes:

- **C Step 12:** `\"test\": \"vitest run\"` (conditionally — only if the suite is green).
- **D Step 12:** `package.json:11-25 — add \"test\": \"vitest run\".` (unconditional)
- **F Step 0:** `\"test\": \"node --test scripts/chat-eval/ && pnpm typecheck && pnpm lint\"` — and *\"The `&& pnpm typecheck && pnpm lint` is not optional.\"*

F's value runs **no vitest at all**; D's runs **no `node --test`**. Whoever lands second overwrites the first and silently removes that suite from CI. None of the three collision sections names this file.

**Fix:** one prescribed value in all three briefs — e.g. `\"test\": \"vitest run && node --test scripts/chat-eval/core.test.mjs scripts/chat-eval/triage-core.test.mjs && pnpm typecheck && pnpm lint\"` — plus a `package.json` row in each brief's collision table.

## 8. Brief C's Acceptance T7 requires a password login, contradicting the mission constraint and C's own stop condition
**`c-honest-data-contract.md` → Acceptance tests T7:**
```
node scripts/chat-eval/run.mjs --base http://127.0.0.1:5457 --email <x> --password <y>
```
`run.mjs:10` documents `--email x --password y` as a real Supabase password sign-in. C's own **Stop condition #2** says: *\"**Do not attempt a login yourself — an account-lockout risk is live on this workspace.**\"* Brief E Step 0 goes further: *\"Do NOT attempt a login. Do NOT run the eval to 'test' the credentials\"* and documents the progressive lockout at `src/server.ts:1176-1189`. Also, as of `2026-07-24T00:17Z` the stored eval credentials return HTTP 401 (E's timeline), so T7 cannot pass regardless.

**Fix:** replace T7 with an unauthenticated local probe (the deterministic handlers accept `tenantId` in the body with no bearer — that's exactly what C's own T6 does), or mark T7 explicitly founder-executed after E's Step 0 resolves.

## 9. Brief F's Acceptance C.6 fires the fleet sweep against production
**`f-real-transcript-eval.md` → Acceptance tests §C, item 6:**
```
node scripts/chat-eval/run.mjs --all --base https://app.aros.live; echo \"exit=$?\"
```
`--all` mints a Supabase **admin magiclink session for every active workspace owner** (`run.mjs:103-117`) and runs 12 metered chat questions per tenant against prod. F itself cites the reason this is off (`chat-eval-nightly.ps1:5-6`, `README.md:80-85`), and brief E restates it. This is a live-production, cross-tenant, session-minting action inside a \"just check nothing regressed\" step.

**Fix:** `node scripts/chat-eval/run.mjs --base <beta-url>` for a single non-founder workspace, or drop the step to \"confirm `run.mjs` and `core.mjs` are byte-unchanged: `git diff --stat origin/main -- scripts/chat-eval/run.mjs scripts/chat-eval/core.mjs`\".

## 10. Brief A never says how `surface` is derived
`chat_conversation.surface text NOT NULL CHECK (surface IN ('aros-chat','concierge','start-chat','api','unknown'))` (§4.1). It appears in `TurnInput` (§4.2), in the step-3 canary log line, in the §4.4(c)/(d)/(f) response bodies, and Acceptance E step 4 asserts `surface \"aros-chat\"`. **No rule anywhere maps an incoming request to one of the five values**, and Step 9 only adds `conversationId` to the client bodies — no client sends a surface. `arosChatTenant`/`isArosChatContext` don't carry one either (both clients send `agentId: 'aros-agent'`; `ConciergeChat` additionally sends `x-channel: aros`).

**Fix:** specify it as declarative data in §4.2 — e.g. a pure `resolveSurface(req, body)` keyed on an explicit client-sent `surface` field (added in step 9) with `'unknown'` as the fallback, since a client-supplied label is diagnostic-only and never authorization (consistent with the brief's own `meta` comment).

## 11. Brief E's Acceptance A2 expects output that cannot be produced by the command given
**`e-watchdog-unsilence.md` → Acceptance tests A2**, pass criterion 2: *\"stdout contains `would CREATE: chat-eval: the eval run itself failed`\"*. The command sets no `GITHUB_TOKEN`. Verified in `triage.mjs:57-58`:
```js
} else if (!TOKEN) {
  console.warn(`[triage] GITHUB_TOKEN not set — skipping issue lane (${issues.length} intents)`);
}
```
The `would CREATE` line only exists at `:64`, inside the `else` branch that first calls `gh(/repos/.../issues?labels=chat-eval&state=open)` — which needs a valid token *and* network. So A2 prints \"skipping issue lane\" and criterion 2 fails on a correct implementation.

**Fix:** either add `GITHUB_TOKEN=<valid ro token>` to A2 and note it needs network, or change criterion 2 to `[triage] GITHUB_TOKEN not set — skipping issue lane (1 intents)` — which still proves the run-error intent reached the lane (count went 0 → 1), and keep criteria 1/3/4 as the real regression proof.

## 12. Brief A steps 2 and 3 are operator/deploy work but are declared \"strictly sequential\" prerequisites for everything else
**Step 2:** *\"Paste the file into the Supabase SQL editor for the AROS project and run it.\"* Codex has no Supabase console. **Step 3:** *\"Run for at least an hour of real traffic on the **deployed surface**, then read the logs\"* — requires a deploy, and the standing rule is do-not-deploy. **Step 6 depends on 3, 4, 5**; steps 7–11 all depend on 6. So a zero-context Codex reaches step 2 and stops, with steps 4 (pure core) and 1 (migration file) as the only deliverable work — but the brief's own header says \"Steps 1 → 2 → 3 are strictly sequential.\"

**Fix:** relabel steps 2 and 3 **[FOUNDER/OPERATOR]** with an explicit handoff artifact (step 2: the exact SQL + the verification queries already written; step 3: the canary log grep), and re-sequence so Codex can land steps 1, 4, 5, and a flag-off step 6 without them.

## 13. Briefs B and D specify Playwright specs against authenticated routes that the repo's own harness cannot reach
Verified: `apps/web/src/app/App.tsx:224-228` — every route that isn't in the explicit public list falls through `<ProtectedRoute>` and, at `:235-242`, redirects when `!onboarded`. `/preview/app` at `:93-95` is the **only** auth-free shell entry, and all four existing specs use it, with in-file comments saying exactly why (`install-app-from-marketplace.spec.ts:7`: *\"The authed install/gate path needs a session — covered by scripts/journey-walk.mjs seams + the browser step on beta\"*).

- **D → Acceptance §3**, owner path step 3: *\"**Go to `/chat`**, type 'Which connectors are active on my account?', submit.\"* Unauthenticated → redirect, never reaches the composer. Step 6 then expects the reconnect modal prefilled on `/stores`.
- **B → Acceptance §6 test 1 (silent recovery)** additionally needs `refreshSession()` to return a fresh token so the second `/v1/chat` call fires. In local Playwright mode `session` is null (`ConciergeChat.tsx:108` guard is falsy), and the brief never says to mock `**/auth/v1/token*`. `fresh === null` → no replay → the \"same `x-idempotency-key` on both requests\" assertion — *\"this is the no-double-side-effect assertion\"* — never runs.

**Fix:** target `/preview/app` (which does mount `ConciergeChat` via `AppShell.tsx:240`) and add an explicit `page.route('**/auth/v1/token**', …)` + `addInitScript` seeding a fake Supabase session to `localStorage` in B's spec setup. Or state plainly that these two specs are beta-only (`E2E_BASE_URL`) and give A1-style local specs as the merge gate.

## 14. Brief G's Step 0 is a hard gate with no runnable command
**`g-item-profile-plugin.md` → Step 0 — GATE:** *\"Run one authenticated, timed call against a real connected tenant's RapidRMS session\"* → `getSalesDetail(session, …)` / `getInvoiceReport(session, …)`. There is no instruction for obtaining `session`: credentials live encrypted in `tenant_connectors.credentials_encrypted` behind `ensureConnectorCrypto()`/`AROS_ENCRYPTION_KEY` (`src/server.ts:3682/3686`), and G's own UNVERIFIED #6 says no deployed-surface probe was made because of the lockout risk. Everything downstream (the whole Decision-1 data path, the migration, the rollup) hangs on this gate, and G's own UNVERIFIED #1 says *\"If InvoiceReport is header-only, the entire item rollup has no source over the HTTP path.\"*

**Fix:** give the exact runnable form — a short `tsx` script that reads one `tenant_connectors` row via `createSupabaseAdmin()` + `decryptedConnectorRecord()` + `withRapidRmsSession` and dumps `Object.keys(rows[0])` — and name whether Codex is authorized to run it or whether it is founder-executed like E's Step 0.

## 15. Brief E Step 7.6 tells the executor to delete the only working credentials after an unverified vault cutover
**`e-watchdog-unsilence.md` → Step 7, item 6:** *\"**Cut over in one move** … After a verified green run through the vault path, **delete `C:/Users/nirpa/.shre/secrets/chat-eval.env`**.\"* Immediately below: *\"The KV mount path, and the `.dpapi` unwrap convention, are **UNVERIFIED** — see Stop conditions\"* — a section that does not exist (finding #1). The `bao kv get <path>/chat-eval` path is literally written as `<path>`. Combined with E's own Step 0 (the credentials currently 401 and the account may be locked), an executor following this deletes the only surviving copy of a credential that may already be broken.

Related, same step: item 4 says *\"have `triage.mjs` write a one-line `verdict.json` … **Choose the `verdict.json` route**\"* — but steps 3 and 4, which own `triage.mjs`, never mention writing `verdict.json`. An executor doing steps 1–5 and skipping the operator-only step 7 ships a `triage.mjs` the runner then can't read.

**Fix:** move the `verdict.json` write into Step 4 (it is a `triage.mjs` change, not a runner change); split 7.6 into \"add the vault path alongside the file, verify green for N runs\" and a separate founder-gated \"delete the plaintext\"; resolve the KV path before writing the step.

---

### Smaller items, still worth fixing
- **B → Step 6.6 (`wait` / 429):** *\"wait 1 s, re-issue the **same** `requestId` once.\"* Verified in `shre-router/src/chat-proxy.ts:1074-1118`: the 409 `isIdempotencyRecentlySeen` check runs **before** the 429 `isRequestInFlight` check, and `markIdempotencySeen` fires at `:1116` on the first request, with `IDEMPOTENCY_TTL_MS = 60_000`. A same-`requestId` retry 1 s later deterministically returns 409, not a success — and `decideChatRecovery(f(409))` returns `{kind:'duplicate'}`, which step 6.6 does not list as an outcome of the 429 path (\"fall through to `action`\"). Specify the 429 path explicitly, or drop the retry and go straight to a `retry_turn` CTA with a fresh id.
- **D → Step 4 CSS:** `.aros-msgacts .aros-chip > span { overflow: hidden; text-overflow: ellipsis; }` — the JSX in the same step renders `{CHAT_ACTION_PRESENTATION[a.type].label}` as a bare text child, no `<span>`. The rule is inert, so the long-label overflow protection the step claims doesn't exist. Either wrap the label in a `<span>` or move the properties onto `.aros-chip`.
- **F → Step 5 `FAMILY_UMBRELLA`:** `{ 'partial-answer': 164, 'empty-reply': 165 }` applied \"after `planIssueActions` (`triage.mjs:61`)\" with **no lane discriminator**. `triage.mjs` is shared with the battery lane, so battery-lane `empty-reply` intents (family already in `ENGINEERING_FAMILIES`) would also be permanently redirected to #165. Gate the rewrite on `intent.questionId.startsWith('transcript:')`.
- **A → Step 1** asserts the exact string `✓ Migration safety check passed (37 migrations scanned)`. Verified: 36 today, so 37 is right — but E, F, G and H each add a migration too, so this exact-count assertion is wrong for whoever lands second. Say \"count increases by one\".
- **A → Acceptance E step 4** expects `messageCount 4` with `model \"aros-store-data\"` on **both** assistant rows, but step 3 only says \"Ask a SECOND question\" without specifying it must also route to `handleArosSalesChat`. Name the second question.
- **A → §4.2** declares `export interface ConversationRow { /* matches chat_conversation columns */ }` and `MessageRow` as empty bodies. The executor must invent the casing convention (`lastMessageAt` vs `last_message_at`) that step 5's insert and step 7's response shaping both depend on. Write the two interfaces out.

---

**Not findings:** I checked and could not fault — B's anchor accuracy (every line number exact, including `authenticateRequest(` = 60), C's ground-truth section (all of `contracts/platform/`, `scripts/test.sh`, `standard-ci.yml:60-80`, `contract-vendored-integrity.test.ts:41-50` verified), I's entire anchor set (`nyBusinessDate(daysAgo = 0)` at `:4145`, `pickStr` at `:73`, `fetchExceptionSummary` imported at `:714`), G's `touch_updated_at()` dependency (exists, `20260424_multi_tenant.sql:140`), G's arithmetic fixtures (4323/100 → min 217 / max 606 and the synthetic seasonal 1/2 both check out against the stated formula), and the `origin/docs/retail-profiles` branch G and H cite (exists, `91135554`).",
