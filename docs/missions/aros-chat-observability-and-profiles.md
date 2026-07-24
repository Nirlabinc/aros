# AROS chat observability + retail profiles

**Slug:** `aros-chat-observability-and-profiles`
**Status:** CONTRACT — not started. Nine briefs authored; **execution blocked on the
pre-flight corrections in Appendix C and the founder decisions in Appendix D.**
**Authored against:** aros `origin/main` @ `9b4a693` (2026-07-23).
**Briefs:** `docs/briefs/{a..i}-*.md` + `COORDINATION-ai-activity-spine.md` +
`EVIDENCE-401-root-cause.md`, on branch `docs/codex-build-briefs`.
**Reviewer note:** run `mission-reviewer` against this file before execution starts and
again before declaring done (shre-dev-kit `discipline/MISSION_DISCIPLINE.md`).

---

## Intent

- **Outcome:** AROS keeps a durable, tenant- and user-attributed record of every chat
  turn; every number it emits carries provenance; every failure it emits carries a named
  cause and one tap forward; and when chat breaks, a human is told the same day. On top
  of that record, ship the retail-profiles surfaces (Items, Customers, register/exception
  identity on alerts) that the same honesty rules make possible.

- **Why now:** on **2026-07-23** AROS chat went from **12/12 to 0/12 on the founder's own
  account** and **nothing alerted**. Three independent defects made that possible and all
  three are still live on `main`:
  1. **No memory.** Zero chat/conversation tables exist in AROS. Every turn is answered
     and discarded, so there is no evidence of what users asked, got, or lost.
     (Track A — verified: 23 `.from()` tables in `src/server.ts`, none chat-related;
     36 migrations, none creating a chat table.)
  2. **No honest failure.** `src/server.ts` ~L980–L1004 has **no `else` branch** when
     `authenticateRequest()` returns `null`, so a Supabase token the router is known to
     reject is forwarded verbatim → `Invalid or expired passport` (401). Six distinct
     causes collapse to one indistinguishable string; the user's typed text is cleared
     before the request, so it is lost on every failure.
     (`docs/briefs/EVIDENCE-401-root-cause.md`.)
  3. **No alarm.** The nightly watchdog reported `LastTaskResult: 0` (SUCCESS) through a
     full-day production outage, because a totally-failed run writes only `summary.json`
     and triage crashes reading the missing `results.jsonl`.
  Separately, live production replies today state `Total Sales: $0.00` for a liquor store
  with real sales, and a full week of "no item-level sales rows" — a confident wrong
  answer, which is worse than an error.

- **Non-goals:**
  - Fixing the metering/billing contract. `shre-meter`, `shre-sdk/src/cost.ts`,
    `toMeterEvent()`, `summary-range.mjs` and the four AROS billing call sites are
    **owned by a concurrent session** (branch `shreai/fix-meter-summary-contract`,
    nothing merged) and are blocked on a founder decision about which shre-meter runtime
    is live. **Treat `cost_events` as EMPTY.** AROS has never billed a dollar of AI usage;
    that is their defect, not this mission's.
  - Building the AI activity spine. Another session owns
    `shre-dev-kit/docs/missions/ai-activity-spine.md` (branch
    `feat/ai-activity-spine-mission`, commits `4dbc058`, `8f20058`). This mission's track A
    **binds to** that actor-stamp contract; it does not author it.
  - Restating or superseding the retail-profiles contract. Tracks G/H/I derive from
    `git show origin/docs/retail-profiles:docs/missions/retail-profiles.md` and its journey
    specs. Reference it; do not fork it.
  - Consumer identity, loyalty, consent tiers, cross-merchant recognition. Those belong to
    Customer Fabric / **REGULARS** (US Provisional 64/113,480) and are a founder escalation,
    not a build.
  - Fixing shre-router's `conversation-memory.ts` tenant-blindness. Report it; do not fix
    it here.
  - The port-5495 shre-meter/shre-deck collision. Operator-gated, not ours.

---

## Scope

- **In (9 tracks):**

  | Track | Slug | One line | Class |
  |---|---|---|---|
  | A | `a-conversation-persistence` | `chat_conversation` + `chat_message` in AROS Supabase, write path at the single `/v1/chat` seam, two read surfaces | **KEYSTONE** |
  | B | `b-auth-401-recovery` | Classify the six auth-null causes on the wire; silent refresh where recoverable; typed CTA where not; never lose typed text | Chat honesty |
  | C | `c-honest-data-contract` | Provenance footer on every number; typed zeros (`no-provenance`, `mapper_drift`, `not_permitted`); `arosChatJson()` as the single reply choke point | Chat honesty |
  | D | `d-actionable-errors` | Server-authored, permission-gated `ChatAction` buttons in the bubble; word- and grapheme-safe truncation; deterministic connector-health handler | Chat honesty |
  | E | `e-watchdog-unsilence` | Heartbeat watermark + freshness check + run-error intent + dedup/cooldown so the watchdog cannot exit 0 while broken | Monitoring |
  | F | `f-real-transcript-eval` | Grade **real** stored turns in three trust tiers; cluster + dedupe into GitHub issues; zero PII in issue bodies; never gates a deploy | Monitoring |
  | G | `g-item-profile-plugin` | **Items** app: "is this still selling, how many should I keep" bound to the merged golden-record layer | Retail profiles Ph2 |
  | H | `h-customer-profile-plugin` | **Customers** app: owner-side repeat-visit analytics keyed on a per-tenant salted hash of brand+last4 | Retail profiles Ph3 |
  | I | `i-alerts-register-exceptions` | Register/terminal identity on void alerts + a real voids answer in chat (aros#168); three Phase-4 triggers deferred with probed cause | Retail profiles Ph4 |

- **Out:** metering/billing; the spine mission itself; `shre-router` code changes
  (read-only reference only); Replit surfaces; anything on `regulars.aros.live`; the three
  deferred Phase-4 triggers (cancelled transaction, price change, manual discount — the
  live warehouse probe proves the source fields do not exist, so building them would mean
  inventing a data contract).

- **Repos/services:** `Nirlabinc/aros` (**all writes**), `Nirlabinc/shreai` (read-only:
  `shre-router/src/reply-check.ts`, `chat-proxy.ts`, `response-cache.ts`,
  `packages/shre-sdk`), AROS Supabase (new tables + RLS), Cortex warehouse (**SELECT only**),
  shre-router `/v1/chat` + `/v1/chat-traces` (2h TTL), the Windows Task `Shre-ChatEval` and
  its runner `~/.shre/tasks/chat-eval-nightly.ps1` (not in any repo), OpenBao vault
  (`vault.aros.live`) for the eval credential migration.

- **Surfaces/users affected:** `app.aros.live` concierge chat (`/chat`, `/preview/app`),
  `/marketplace`, new `/items` and `/customers` nav entries, automation void alerts
  (SMS/email — note SMS is *currently undelivered*, see `stm_aros_sms_undelivered`),
  a new platform-owner conversations read surface, and the nightly eval report/issue lane.

- **Data/external systems affected:** AROS Supabase (**new PII-bearing tables**:
  transcripts, grades, card fingerprints, owner notes), the golden-record layer
  (`canonical_entity`, `entity_alias`, `canonical_strong_key`, `merge_candidate`,
  `negative_pair`, `merge_event` — **bind, never fork**), `audit_log`, `platform_settings`,
  GitHub issues on `Nirlabinc/aros`, and the founder's personal prod account
  `npatel@rapidrms.com` (**lockout risk live — see Appendix D**).

---

## Execution model

- **Owner agent:** **Codex** (Builder), one track at a time in an isolated worktree.
  **Claude designs, Codex executes. Author ≠ integrator.** The founder approves every
  merge and every live activation.
- **Supporting agents:**
  - *Planner* — Claude (this contract + the nine briefs). Ships no code.
  - *Reviewer* — `mission-reviewer` before execution and before done; `code-review` /
    `security-review` per PR; a cross-track collision re-audit after each merge that
    touches the `/v1/chat` dispatch block or `scripts/chat-eval/`.
  - *Verifier* — `journey-walker` for D/G/H surfaces (`node scripts/journey-walk.mjs`
    then browser steps marked NEEDS-BROWSER).
  - *Operator* — **founder only**: prod SQL, deploys, service restarts, the eval login,
    the OpenBao cutover, the `--all` fleet sweep (which stays OFF).
  - *Integrator* — founder, on green, in the merge order in Appendix B.
- **Skills/playbooks:** shre-dev-kit `discipline/MISSION_DISCIPLINE.md`,
  `discipline/PROGRAMMING_STYLE.md` (functional core, imperative shell),
  `discipline/APP_BUILD_STANDARDS.md`; aros `.claude/JOURNEY_GATE.md` (G/H/D add or alter
  journeys and therefore need a Journey Spec + golden-path E2E; A/B/C/E/F/I must say
  explicitly which journey they alter or that they alter none).
- **Required permissions:**
  - Codex: read the whole repo; write only inside its own worktree under
    `~/.shre/worktrees/aros/<track-slug>`; run local gates; read-only probes of live
    surfaces. **No push, no PR, no deploy, no restart, no production write, no login.**
  - Never run branch-switching or tree-mutating git in
    `C:/Users/nirpa/Documents/Projects/aros` or `.../shreai` — concurrent sessions are
    live on both. Read other refs with `git show <ref>:<path>`.
- **Required secrets source:** OpenBao (`vault.aros.live`) / SOPS mirror `~/.shre/vault`,
  AppRole on this device. Interim plaintext custody exists at
  `~/.shre/secrets/chat-eval.env` and `~/.shre/vault/cortexdb.json` (key
  `~/.shre/.vault-key`). **`AROS_ENCRYPTION_KEY` must be present and ≠ the `'aros-dev'`
  fallback before H can be activated in prod — UNVERIFIED today.**
- **Worktree/branch:** briefs live on `docs/codex-build-briefs` in
  `~/.shre/worktrees/aros/chat-observability`. **One worktree and one branch per track**
  (`feat/<track-slug>`), because five tracks edit `src/server.ts` and three edit
  `scripts/chat-eval/`. No two tracks share a branch.

---

## Contract

### Inputs

- The nine briefs, the two evidence/coordination notes, and the three cross-check lenses
  (collision / constraints / executability) whose findings are consolidated in Appendix C.
- The retail-profiles contract on `origin/docs/retail-profiles` (PR #202, OPEN, docs-only).
- The AI activity spine contract on `feat/ai-activity-spine-mission` (`4dbc058`, `8f20058`)
  and its reference implementation, Centrix `server/ai-executor.ts:58–134` + `logAction:808`.
- Founder answers to every item in Appendix D. **Several are hard gates: work that depends
  on them does not start.**

### Expected outputs

1. Nine merged PRs on `Nirlabinc/aros`, each with its own local gate evidence.
2. Migrations, each with `ENABLE ROW LEVEL SECURITY` **in the same file** as the
   `CREATE TABLE`, plus explicit `REVOKE ALL … FROM anon, authenticated` where the table is
   service-role-only: `chat_conversation`, `chat_message` (A); `chat_grades` (F);
   `platform_settings` seed only (E); six Items tables (G); four Customers tables (H); one
   **pre-flight** migration fixing `canonical_strong_key` RLS and one agreed `entity_note`
   DDL, both owned by neither G nor H (Appendix B, step 0).
3. Pure modules with named reviewer greps: `src/chat/transcript.ts`, `src/chat/redact.ts`,
   `src/authFailure.ts` + `chatRecoveryLogic.ts`, `src/chat/freshness.ts`,
   `src/chat/connectorActions.ts` + `truncate.ts`, `src/chat/exception-intent.ts`,
   `scripts/chat-eval/triage-core.mjs`, `scripts/chat-eval/transcript-core.mjs`,
   `src/items/*`, `src/customers/*`.
4. One `CHAT_ACTION_TYPES` union in one file (`apps/web/src/aros-ai/actions.ts`), one PAN
   redactor, one `arosChatJson()` reply choke point, one `entity_note` DDL, one
   `package.json` `"test"` value.
5. A watchdog that cannot exit 0 while broken, and a nightly transcript-grading lane that
   files deduplicated, PII-free issues and gates nothing.
6. Updated memory notes (see Handoff) and this contract, marked done or killed per track.

### Success signal

Ranked. The first two are the mission; the rest are supporting.

1. **Chaos test passes.** With the founder watching, deliberately break authed chat on a
   non-production workspace. Within one nightly cycle: the eval run reports non-green, the
   freshness/run-error intent fires, **exactly one** alert reaches a human, and the stored
   transcript shows the classified failure code against the conversation. Today all four of
   those are zero. *This is the only signal that proves the mission's stated reason for
   existing.*
2. **The transcript is the record.** A signed-in user's history survives reload, device
   change, and "clear chat"; the founder answers "what did users ask, what did they get,
   what failed" from SQL. Every stored turn carries the spine's actor stamp — one
   attribution path, not two.
3. **No number without provenance.** Every figure in a chat reply carries store scope,
   source connector, `asOf`, and live/cached/stale/demo state; every zero is typed. The
   `$0.00`-for-a-real-liquor-store reply is impossible to produce.
4. **No dead end.** `HTTP <n>` cannot reach a bubble; every failure names a cause and
   offers one tap forward; typed text is never lost; a member who cannot repair a
   connection never sees the repair button.
5. **Zero horizontal page scroll at 320–1440px in both orientations**, asserted with a real
   `scrollWidth <= clientWidth` check, on every surface D/G/H ship.
6. **Retail profiles:** owner installs Items and Customers from `/marketplace`, sees real
   sourced sentences or an honest "I can't know that", and void alerts name the register.

### Failure signal

Be blunt about these — each is a *defect*, not a delay:

- **Anything in Appendix C merges unresolved.** Every item there is a verified,
  reproducible break, not a style note.
- **A second attribution path ships.** Track A designs `chat_message` without binding to
  the spine's actor stamp. COORDINATION calls this a stop condition with the same force as
  forking `canonical_entity`, and track F silently inherits the wrong model.
- **A silent no-op migration ships.** Two `CREATE TABLE IF NOT EXISTS entity_note` with
  different columns: the second is a no-op, nothing errors, `check-migration-safety.mjs`
  passes, and the *runtime* breaks for whichever track merged second.
- **`holder_fp` is readable by tenant members.** The table-level `GRANT SELECT` precedes
  the column-level `REVOKE`, so per PostgreSQL the revoke does nothing. A stable
  per-consumer identity token derived from a cardholder name becomes selectable over
  PostgREST, and H's own leak test cannot see it because it only serialises handler
  projections.
- **Production rows land in `canonical_strong_key` while it has neither RLS nor a REVOKE.**
- **The dispatch block merges out of order** and a handler is silently dropped, or a new
  handler emits un-gated, provenance-free replies around C's choke point.
- **`package.json` `"test"` is overwritten** by the second track to touch it, silently
  removing a suite from CI — the exact failure class this mission exists to end.
- **A prod-affecting acceptance step is executed by an agent**: the `--all` fleet sweep
  (mints an admin magiclink session for every active workspace owner and runs 12 metered
  chat questions per tenant against prod), or any login attempt against
  `npatel@rapidrms.com`.
- **Merged but never activated.** Nine green PRs, nothing deployed, no alert path live —
  the founder still finds out about the next outage by hand. **Merged ≠ done for this
  mission.** The chaos test in Success signal #1 is the bar.

### Kill criteria

Honest kill conditions. Hitting one is a *result*, not a failure to hide.

- **Whole mission:** if the AI activity spine lands its AROS increment first with a
  conversation/activity store, **kill track A's schema outright** and re-scope A to a
  binding + read-surface track. Two stores is the worse outcome than a late one.
- **Whole mission:** if after the corrections land the chaos test still cannot be run
  because there is no non-production workspace and no non-founder eval account, **stop and
  fix that first.** Everything else is unverifiable theatre without it.
- **Track A:** if the pre-step-1 prod check finds a `chat%` table created out of band with
  a different shape → stop; founder decides adopt vs. replace. If the step-3 canary shows
  `authenticateRequest` does not resolve for the target surface, A cannot attribute turns
  → stop; the whole observability arm is degraded and must be re-planned, not worked around.
  If 90-day retention is not ratified, A does not ship — this is PII with a delete clock.
- **Track E:** if the eval credentials stay 401 and the account is locked, E ships the
  heartbeat plumbing but **the mission's alerting outcome is unmet** until a dedicated
  `eval@` member per tenant exists. Do not call E done on merged code alone.
- **Track F:** tier 2 (as-of deterministic) dies if A ships without `from_cache` — grounding
  stats are corrupted, not merely absent, because shre-router's response-cache key has **no
  tenant component**, so another tenant's cached reply can be graded as this one's. If
  `from_cache` cannot be added, **ship tiers 1 and 3 only and say so**. If real transcript
  volume is too low to cluster (< ~50 real turns/week), F's DB writes are not worth it —
  keep the report lane, drop the grades table.
- **Track G:** if the `InvoiceReport` probe shows header-only rows, the item rollup has **no
  source over the HTTP path** → kill the Decision-1 data path and the migration with it,
  and return to the founder. If `should-i-reorder-this.md` is still `STATUS: DRAFT`, G does
  not start — no "provisional" tables.
- **Track H:** kills on any of — `pan_risk_rows > 0` on the probe (hard stop, PCI), no legal
  /privacy sign-off for storing a card fingerprint + purchase history, `AROS_ENCRYPTION_KEY`
  absent or equal to `'aros-dev'`, or no Cortex read path. Steps 1–5 may proceed; **no number
  ships to a tenant** until all four clear.
- **Track I:** the three deferred Phase-4 triggers stay dead unless a re-probe (not a
  re-argument) finds the source fields. The `automation_fires` unique key blocks any second
  trigger type until widened.
- **Track D/B:** if the founder decides `ArosChat.tsx` stays dead, D's step 7f is deleted
  rather than reconciled.

### Rollback/compensation

- **Per track:** each brief carries its own Rollback section; that is the primary path.
- **Migrations:** additive only. Rollback = stop writing + `DROP TABLE` of the tables that
  track created, never a destructive `ALTER` on a shared table. `entity_note` and
  `canonical_strong_key` are **shared** — their pre-flight migration rolls back only if
  neither G nor H has merged.
- **Server behaviour:** every new chat behaviour ships behind a flag or an early return so
  it can be disabled without a revert (`arosChatJson()` degrades to the current
  `json(res, 200, …)`; persistence degrades to a no-op `afterChatTurn`; the connector-health
  handler degrades to falling through to the LLM).
- **Prod SQL is hand-applied by the founder** (A step 2) — capture the exact statements and
  the verification queries in the PR body so the inverse is one paste.
- **Credentials:** never delete the plaintext `chat-eval.env` until N consecutive green runs
  through the vault path. Cutover and deletion are two separate, founder-gated steps.
- **Deploy:** AROS prod is a hand-managed fork at `/opt/aros-platform` with truth in
  `DEPLOY-LOG.md` on the box. Any deploy is operator work with a pre-deploy snapshot.

---

## Verification

- **Local gate (per PR, must be green before review):**
  `pnpm typecheck && pnpm lint && pnpm build`, `node scripts/check-migration-safety.mjs`
  (assert the migration count **increases by one**, not an absolute number — five tracks add
  migrations), `vitest run`, `node --test scripts/chat-eval/`, and the agreed single
  `package.json` `"test"` value running **both** suites.
- **Integration gate:** after each merge that touches `src/server.ts:6783-6792` or
  `scripts/chat-eval/`, re-run the collision audit against the next track's brief before it
  starts. Static RLS linter must pass; anon-key and foreign-tenant-JWT reads against every
  new table must return **zero rows**; a service-role read must return the rows it wrote;
  the `holder_fp` negative test must **error**, not return rows.
- **Real-flow smoke/E2E:**
  - Chat: drive `/preview/app` (which mounts `ConciergeChat` via `AppShell.tsx:240`) with a
    seeded fake Supabase session and a mocked `**/auth/v1/token**` route — **not** authed
    `/chat`, which redirects under the repo's Playwright harness. Any spec that genuinely
    needs prod is beta-only via `E2E_BASE_URL` and is **founder-executed**.
  - Journey gate: `node scripts/journey-walk.mjs --base <beta-url>`, then `journey-walker`
    for NEEDS-BROWSER steps, for D, G, H.
  - Zero horizontal scroll: real `scrollWidth <= clientWidth` at 320/768/1024/1440 in both
    orientations. E and F waive this explicitly (no surface) — that waiver is correct and
    must stay explicit rather than becoming an untested claim.
  - **The chaos test** (Success signal #1) is the mission-level real-flow gate. It is
    founder-run, on a non-production workspace, once, at the end.
- **Reviewer agents:** `mission-reviewer` (before execution, before done), `code-review`
  per PR, `security-review` on A, F, G, H (all four ship PII or golden-layer writes), and a
  named human/founder read of every migration before it is applied to prod.
- **Evidence location:** `docs/briefs/` (design + verified ground truth),
  `docs/missions/aros-chat-observability-and-profiles.md` (this file — update Handoff per
  track), PR bodies (gate output + exact prod SQL), `scripts/chat-eval/reports/<run>/`
  (eval runs), and the memory notes listed under Handoff.

---

## Handoff

- **Current state:** **Design complete, execution not started.** Nine briefs authored
  against `9b4a693`, each with `path:line` anchors that spot-checks confirmed exact
  (~30 anchors verified across A/B/C/E/I, all correct). Three cross-check lenses have run:
  **collision (12 findings), constraints (6 findings), executability (15 + 6 minor)**.
  Consolidated to **26 blocking corrections in Appendix C** — dedup means several findings
  are the same defect seen from two lenses. **No brief may be handed to Codex until its
  Appendix C items are folded in.** Nothing is merged; nothing is deployed.

- **Remaining gaps (known, named, not hand-waved):**
  1. All 26 corrections in Appendix C.
  2. All founder decisions in Appendix D — four of them are hard gates.
  3. No non-production workspace and no non-founder eval account exist. Without them the
     chaos test, C's T7, F's C.6, and G's Step 0 have no safe way to run.
  4. Prod Supabase has not been read; whether a `chat%` table already exists out of band is
     UNVERIFIED and must be settled before A step 1.
  5. AROS SMS is currently undelivered end-to-end (Twilio 30032/30034) — track I's alert
     improvement lands on a channel that does not reach anyone. Email path only until that
     clears.
  6. The concurrent spine mission and this one are live in the same repos at the same time.
     Standing rule: **coordinate, don't collide** — re-read shared files before editing,
     isolate commits, surface a collision the moment it appears rather than resolving it
     silently.

- **Follow-up queue (out of scope here, do not lose):** shre-router
  `conversation-memory.ts` tenant-blindness; the untenanted response-cache key
  (`response-cache.ts:74`); AROS has never billed AI usage (`totalBilledUsd` reads a field
  shre-meter has never returned → `|| 0`); the `automation_fires` unique-key widening; the
  80-char upstream truncation whose origin is outside this repo; the shre-meter runtime
  decision and the port-5495 collision.

- **Memory/update target:** `stm_aros_chat_eval_harness_2026-07-20.md`,
  `stm_chat_effort_closeout_2026-07-23.md`, `stm_aros_validation_sweep_2026-07-21.md`,
  and a new `stm_aros_chat_observability_mission_2026-07-24.md` recording what shipped, the
  chaos-test result, and the next gap. Update `MEMORY.md` when the first track merges, not
  when the briefs land.

---

## Appendix A — Track ledger

| Track | Blocked by | Blocks | Hard gate before start |
|---|---|---|---|
| A | Spine binding (Appendix D-1); prod `chat%` check; retention ratification | F (steps 6,7,9,10); all future monitoring/learning | D-1, D-2, D-3 |
| B | none | nothing hard; establishes the wire contract C/D key on | — |
| C | none | D, I (both must emit through `arosChatJson()`) | — |
| D | C (choke point); shares `actions.ts` with B | nothing | resolve `ArosChat.tsx` (D-6) |
| E | none | F (hands over the metering + eval-account constraints) | D-4 (vault path), D-5 (eval creds) |
| F | **A** (steps 6,7,9,10); E and C on shared `scripts/chat-eval/` files | nothing | A's schema must carry `from_cache` + `trace_id` |
| G | Pre-flight migration (Appendix B step 0); journey spec approval | H (key discipline precedent); Phase 4 sequencing | D-7 (journey DRAFT), D-8 (Step 0 probe) |
| H | Pre-flight migration; Cortex read path; legal sign-off; `AROS_ENCRYPTION_KEY` | nothing | D-9, D-10, D-11 |
| I | C (choke point) | any second automation trigger type | — |

---

## Appendix B — Merge order (the only globally satisfiable sequence)

The briefs' own declared orders **contradict each other**: B claims precedence over A while
A never names B; C claims precedence over D and I while neither names C; A calls itself the
keystone that starts first, yet must land **last** in the `/v1/chat` dispatch block. Those
are different files, and no brief distinguishes them. The resolution:

**0. Pre-flight (owned by neither track, merges before G and H):**
   - one migration adding `ENABLE ROW LEVEL SECURITY` **and**
     `REVOKE ALL ON public.canonical_strong_key FROM anon, authenticated;`
   - one agreed `entity_note` DDL (G's polymorphic superset: `entity_type` +
     `entity_key`, nullable `canonical_id`, CHECK widened to `('product','customer')`,
     one `UNIQUE (tenant_id, entity_type, entity_key)`), pasted byte-identically into both
     briefs or extracted into its own migration both depend on.
   - one agreed `package.json` `"test"` value running vitest **and** `node --test` **and**
     `pnpm typecheck && pnpm lint`, with a `package.json` row added to C's, D's and F's
     collision tables.

**1. B steps 1–3** (server-side auth classification + log, ~40 lines, self-contained) —
   before A touches `proxyRequest`.

**2. C** — establishes `arosChatJson()` as the single reply choke point. Everything that
   emits a chat reply afterwards emits through it.

**3. D** — its fifth handler (`handleArosConnectorHealthChat`) emits via `deps.arosChatJson`,
   not `deps.json`.

**4. I** — its `exceptions` branch emits via `arosChatJson()` and **carries a Provenance
   block, because it prints money** (a void count and amount).

**5. A** — migration + pure core (steps 1, 4, 5) may land earlier as its own PR; the
   `src/server.ts` capture shim wraps **whatever chain exists** at merge time, not the
   four-handler snippet the brief hard-codes.

**6. F** steps 6, 7, 9, 10 — after A's migration is applied. F's migration renames to
   `20260725_chat_grades.sql` (so it sorts after A's `20260724_chat_transcripts.sql`) and
   FKs `public.chat_message(id)`.

**Independent lanes:** E, G, H. Inside `scripts/chat-eval/` the order is
**E (structural `triage.mjs`/`triage-core.mjs`) → F (families + umbrella) → C
(error-phrase contract in `core.mjs`)** — E and F both restructure the same issue-lane
region, and C and F both edit `core.mjs:105`.

---

## Appendix C — Blocking corrections (fold into the briefs before handing them to Codex)

Deduplicated across the three lenses. **Severity S = ship-stopper, H = high, M = medium,
L = low.** Every one was verified against `origin/main` @ `9b4a693`.

**Security / data-integrity**

1. **(S)** *H, migration line 783.* The table-level `GRANT SELECT` at line 779 precedes the
   column-level `REVOKE SELECT (holder_fp)`, so per PostgreSQL the revoke is a **no-op** —
   hashed cardholder name is readable by every tenant member over PostgREST. Fix: grant an
   explicit column list that omits `holder_fp` and delete line 783; better, move `holder_fp`
   to a service-role-only sidecar table. Add a negative test asserting an authenticated
   select on `holder_fp` **errors**.
2. **(S)** *G ground truth, "golden-record layer" bullet 6.* `canonical_strong_key` has
   **no RLS, no policy, and no REVOKE** — the one golden table with no gate of any kind, and
   the one holding `upc`/`sku` (G) and `card_fp` (H). G calls its absence "deliberate"; it is
   a defect (H documents it). G is sequenced to write production rows into it first. Fix per
   Appendix B step 0; correct G's ground-truth wording.
3. **(S)** *G §Migration vs H §Migration.* `public.entity_note` DDL differs in six ways
   (`entity_type`, `entity_key`, `canonical_id` nullability + delete rule, body CHECK,
   `created_by` FK, UNIQUE). Both use `CREATE TABLE IF NOT EXISTS`, so the second is a
   **silent no-op** and breaks at runtime. **H's collision table asserts the two DDLs are
   "identical text" — that claim is false and must be deleted**, or nobody runs H's own Q11
   check. G's collision table does not mention `entity_note` or track H **at all**.
4. **(S)** *A, whole brief.* A contains **zero** references to the AI activity spine, the
   actor stamp, COORDINATION, or Centrix. COORDINATION declares binding a **stop condition**
   with the same force as forking `canonical_entity`. Fix: add a "Bind to the AI activity
   spine" subsection **before step 1** citing `shre-dev-kit/docs/missions/ai-activity-spine.md`
   (`4dbc058`, `8f20058`) and Centrix `server/ai-executor.ts:58–134` / `logAction:808`, with a
   column-by-column justification for every divergence.
5. **(H)** *A §4.2, D §6, F §3.* Three tracks each invent a PAN redactor with **divergent
   semantics** — A is Luhn-gated with an explicit negative test that `'2026072420260724'`
   survives byte-identical; D and F redact any 13–19 digit run and would destroy that
   fixture. Fix: one owner — `src/chat/redact.ts` exports A's Luhn-gated `redactPan`; A
   imports it; D's `redactUpstreamError` composes it; F mirrors it across the `.ts`/`.mjs`
   boundary with a shared fixture list and a drift note.
6. **(M)** *H collision table line 1250.* Claims a mutual `STRONG_KEYS` conflict with G.
   **G touches no file under `src/golden/`.** The real issue: H is the **only** track mutating
   merged golden-record code (adding `'card_fp'` to `STRONG_KEYS.customer`) and frames it as
   a routine rebase. Replace the false row with an explicit founder-ratification escalation.

**Cross-track correctness**

7. **(S)** *C step 10 vs F acceptance A.4.* C deletes `core.mjs`'s 8 `ERROR_PHRASES` and
   adopts the router's 10 — which share **none** of the five phrases F's headline detector
   needs. After C, the verbatim production string *"…Please try again later or contact an
   administrator for assistance."* scores **pass**. Fix: `errorLeakPhrases` in
   `reply-check.v1.json` must be the **union (18)**; C step 6's "same 10 entries" becomes
   "widen to the union"; add F's aros#168 string to `reply-check.v1.cases.json`.
8. **(S)** *F §Data contract 1–2 vs A §4.1.* F's stated hard dependency is unsatisfiable:
   `from_cache` (**F marks it blocking — without it grounding stats are silently corrupted**,
   and shre-router's cache key has no tenant component) and `trace_id` (the only durable join
   key to `/v1/chat-traces`, 2h TTL) are **absent from A**; F FKs `public.chat_turns(id)` while
   A's table is `chat_message`; and F's `20260724_chat_grades.sql` sorts **before** A's
   `20260724_chat_transcripts.sql`, so a fresh apply fails on an unresolvable FK. Fix: add both
   columns to A §4.1 and have `extractShre` populate them; rename F's migration to `20260725_`;
   point the FK at `chat_message(id)`. Reconcile `turn_index`/`seq` and `resolved_model`/`model`.
9. **(S)** *B C4 vs D acceptance §1.* B's `reauth → path: '/login'` fails D's link-validity
   invariant — verified, `apps/web/src/redesign/routes.ts:8-22` has no `/login` key
   (`/wallet` and `/connection-health` are present). And D's `truncateParity.test.ts` asserts
   **deep equality** between the server and client unions while B deliberately adds four
   client-only types. Fix: `reauth` gets `path: null` + a callback (B's step 7e already
   requires callback behaviour); D's parity test asserts server ⊆ client.
10. **(H)** *A step 6, C step 3, D step 6, I slice B.* Four tracks rewrite the same 9-line
    `/v1/chat` dispatch block (`src/server.ts:6783-6792`) and the declared order is
    self-contradictory. **Only B and H name any sibling brief; A, C, D, E, F, G, I are
    package-blind.** Fix: publish Appendix B's order in every affected brief.
11. **(H)** *E steps 1/3/4, F steps 3/4/5, C step 10.* Three tracks edit
    `scripts/chat-eval/{core,triage-core,triage}.mjs` with three independent ownership claims
    and no stated sequence; E and F restructure the **same issue-lane region** of `triage.mjs`.
    Fix: single owner per file plus Appendix B's order; C step 10 gated on F steps 3/4.
12. **(H)** *A §9/step 9/acceptance E, D §S + step 7f, B non-goal 5.*
    `apps/web/src/aros-ai/ArosChat.tsx` is **unmounted dead code** (declaration + four
    comment references; the mounted concierge is `ConciergeChat` via `AppShell.tsx:3,240`).
    A builds its keystone acceptance test — *"the only test that proves the keystone"* — on
    opening a widget that does not exist, and gates the whole track on a canary that will
    resolve zero such requests (a **STOP** by A's own step 3). B says leave it alone; D says
    modify it. Fix: rewrite A §9/step 9/acceptance E around `ConciergeChat`; founder resolves
    B-vs-D. Knock-on: A's `surface` CHECK values `aros-chat` and `start-chat` are both
    unreachable (`StartChat.tsx:131` sends no `Authorization` header and A drops anonymous
    turns) — only `concierge` is ever written.
13. **(M)** *A §4.1 vs F.* A's `purge_expired_chat_transcripts()` hard-deletes `chat_message`
    at 90 days; F's `chat_grades.turn_id … ON DELETE CASCADE` then wipes the entire
    quality-trend history on a rolling 90-day window. Fix: either `ON DELETE SET NULL` with
    `tenant_id` + `business_date` retained, or ratify the 90-day horizon as a product decision
    in **both** briefs.

**Executability (a zero-context Codex cannot run these as written)**

14. **(S)** *A, B, E, I.* All four cite a **"Stop conditions" section that does not exist**
    (A lines 46, 643, 833; B:1144; E:380, 601, 939; I:129, 262, 911) — including
    *"90 days is a proposal requiring founder ratification — see Stop conditions"* and
    *"If `authResolved` is false … STOP"*. C, D, F, H have the section. An executor hits
    "STOP" and, finding nothing, keeps going with an unratified 90-day PII retention default.
15. **(S)** *F acceptance §C item 6.* `run.mjs --all --base https://app.aros.live` mints a
    Supabase **admin magiclink session for every active workspace owner** and runs 12 metered
    chat questions per tenant **against production**, inside a "check nothing regressed" step.
    F itself documents why `--all` is off. Replace with a single non-founder beta workspace,
    or a `git diff --stat` byte-unchanged assertion.
16. **(S)** *C acceptance T7.* Prescribes `run.mjs --email … --password …`, a real Supabase
    password sign-in — contradicting C's **own** stop condition #2 and E's step 0, and the
    live account-lockout risk. The stored credentials also currently return 401. Replace with
    the unauthenticated local probe C's own T6 already uses, or mark founder-executed.
17. **(S)** *E step 7.6.* Instructs deleting `~/.shre/secrets/chat-eval.env` — the only
    working credential copy — after a cutover whose KV path is literally written `<path>` and
    marked UNVERIFIED, pointing at the missing Stop conditions section. Split into
    "add vault path, verify green N runs" and a separate founder-gated deletion. Same step:
    `verdict.json` is required by the runner but never written by steps 3/4 that own
    `triage.mjs` — move the write into step 4.
18. **(H)** *A §4.3 vs step 6 vs step 6.8.* The persistence timing contract contradicts
    itself: *"runs entirely after `res.end()`, adds 0 ms"* vs *"hold the final chunk until
    the conversation id is known, bounded at 250 ms"*. Fix: mint the id **synchronously and
    locally** (`crypto.randomUUID()`) before the handlers run, inject with zero I/O, insert
    after `res.end()`. Then acceptance F's `< 5 ms p95` budget — which is otherwise
    **guaranteed to fail**, because its 50-iteration loop sends no `conversationId` and so
    mints 50 conversations with a pre-flush insert each — becomes real.
19. **(H)** *A steps 2 and 3.* "Paste into the Supabase SQL editor" and "run an hour of real
    traffic on the deployed surface" are **operator/deploy work** declared as *strictly
    sequential* prerequisites for steps 6–11. Label them **[FOUNDER/OPERATOR]** with explicit
    handoff artifacts and re-sequence so Codex can land steps 1, 4, 5 and a flag-off step 6.
20. **(H)** *A §4.1/§4.2.* No rule anywhere maps a request to one of the five `surface`
    values, yet `surface` appears in the CHECK, in `TurnInput`, in the canary log, in three
    response bodies, and in an acceptance assertion. Specify a pure
    `resolveSurface(req, body)` with `'unknown'` as fallback and a client-sent, diagnostic-only
    label (never authorization).
21. **(H)** *B acceptance §6 test 1, D acceptance §3.* Both drive authenticated routes the
    repo's Playwright harness cannot reach (`App.tsx:224-242`; `/preview/app` at `:93-95` is
    the only auth-free shell entry, which is why all four existing specs use it). B's spec
    additionally never fires its replay because `session` is null locally, so the
    same-`x-idempotency-key` assertion — *"the no-double-side-effect assertion"* — never runs.
    Fix: target `/preview/app` + `page.route('**/auth/v1/token**', …)` + seeded fake session,
    or declare them beta-only and supply local merge-gate specs.
22. **(H)** *G step 0 — a hard gate with no runnable command.* "Run one authenticated, timed
    call against a real connected tenant's RapidRMS session" with no instruction for obtaining
    `session` (credentials are encrypted behind `ensureConnectorCrypto()`/`AROS_ENCRYPTION_KEY`).
    Everything downstream hangs on it. Supply the exact `tsx` script
    (`createSupabaseAdmin()` + `decryptedConnectorRecord()` + `withRapidRmsSession`, dump
    `Object.keys(rows[0])`) and state whether Codex may run it.
23. **(H)** *C step 12, D step 12, F step 0.* Three different prescribed values for the same
    `package.json` `"test"` script (F's runs no vitest; D's runs no `node --test`). Whoever
    lands second silently removes a suite from a CI that today exits 0 with
    *"No test script; skipping strict checks"*. Fix in Appendix B step 0.
24. **(M)** *E acceptance A2.* Pass criterion 2 expects `would CREATE: chat-eval: the eval run
    itself failed`, but the command sets no `GITHUB_TOKEN` and `triage.mjs:57-58` prints
    *"GITHUB_TOKEN not set — skipping issue lane (N intents)"* instead. The correct-implementation
    case fails the test. Assert the skip line with count 0 → 1.
25. **(M)** *B step 6.6.* "wait 1 s, re-issue the **same** `requestId`" deterministically
    returns **409**, not success: `shre-router/src/chat-proxy.ts:1074-1118` runs the 409
    `isIdempotencyRecentlySeen` check **before** the 429 in-flight check, and
    `markIdempotencySeen` fires at `:1116` with a 60 s TTL. `decideChatRecovery(409)` returns
    `{kind:'duplicate'}`, an outcome step 6.6 does not list. Specify the 429 path or go
    straight to a `retry_turn` CTA with a fresh id.
26. **(L)** Minor but real: **E C5** re-declares the full `platform_settings` DDL already in
    `20260723_platform_settings.sql:9-15` (two `CREATE TABLE`s, one table, two files — keep
    only the REVOKE + seed). **D step 4** CSS targets `.aros-chip > span` while the JSX renders
    a bare text child, so the overflow protection is inert. **F step 5** `FAMILY_UMBRELLA`
    has no lane discriminator and would permanently redirect battery-lane `empty-reply`
    intents to #165 — gate on `intent.questionId.startsWith('transcript:')`. **A step 1**
    asserts an exact migration count of 37 — five tracks add migrations; assert "increases by
    one". **A acceptance E** expects `model "aros-store-data"` on both assistant rows but
    never names the second question. **A §4.2** ships `ConversationRow`/`MessageRow` as empty
    interface bodies, forcing the executor to invent the casing convention that steps 5 and 7
    both depend on — write them out.

---

## Appendix D — Founder decisions required (do not assume; several are hard gates)

| # | Decision | Gates | Why it cannot be inferred |
|---|---|---|---|
| D-1 | **Does track A bind to the spine, or is A's schema killed in favour of the spine's AROS increment?** | **A (start), F** | Two live missions, same repo, same week. COORDINATION calls a second attribution path a stop condition. |
| D-2 | **Ratify `CHAT_RETENTION_DAYS` (proposed 90) as an input to both A and F.** | **A (ship), F** | PII with a delete clock, and it silently truncates F's quality-trend history. |
| D-3 | **Read prod: does a `chat%` table already exist out of band?** | **A step 1** | No live DB read was performed; the prod schema has drifted before. |
| D-4 | **The OpenBao KV mount path and the `.dpapi` unwrap convention for `chat-eval`.** | **E step 7** | Written literally as `<path>` in the brief; UNVERIFIED. |
| D-5 | **Are the eval credentials still valid, and is `npatel@rapidrms.com` locked?** Plus: approve a dedicated **`eval@` member per tenant** instead of the founder's personal account. | **E, F, C T7, the chaos test** | Only the founder may attempt a login. One failed run already occurred at 2026-07-24T00:17Z. |
| D-6 | **`ArosChat.tsx`: stays dead (delete D step 7f) or gets extended (amend B non-goal 5)?** | **A, B, D** | Two briefs give opposite orders for the same dead file. |
| D-7 | **Is `docs/journeys/should-i-reorder-this.md` approved?** It is `STATUS: DRAFT`. | **G (no migration until approved)** | The mission's Phase 1 is a gate; no provisional tables. |
| D-8 | **May Codex run G's step-0 authenticated RapidRMS probe, or is it founder-executed?** | **G (whole track)** | Needs decrypted tenant credentials; G's own UNVERIFIED #1 says the entire item rollup dies if `InvoiceReport` is header-only. |
| D-9 | **Legal/privacy sign-off for storing a card fingerprint + purchase history.** | **H (any number shipping to a tenant)** | Journey lists it as mirroring `TERMS_GATE_ENABLED`; no sign-off record found either way. |
| D-10 | **Confirm `AROS_ENCRYPTION_KEY` is present in prod and ≠ `'aros-dev'`.** | **H activation** | Operator-only read; UNVERIFIED. |
| D-11 | **Ratify H adding `'card_fp'` to `STRONG_KEYS.customer` in the merged golden layer.** | **H step 1** | The only mutation of merged golden-record code in the package; the standing rule is bind-don't-extend. |
| D-12 | **Approve the chaos test** (deliberately break authed chat on a non-production workspace) — and provide the workspace. | **Mission-level done** | Without it the mission's stated outcome is unverifiable. |
| D-13 | **Accept that track I's alert improvement lands on a channel that currently delivers nothing** (AROS SMS undelivered, Twilio 30032/30034), or fix delivery first. | **I's user-visible value** | Shipping a better message to a dead channel is not an outcome. |
