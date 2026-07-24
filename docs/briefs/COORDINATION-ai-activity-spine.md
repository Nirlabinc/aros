# COORDINATION (not a brief) — this package overlaps a live concurrent mission

Recorded 2026-07-24 from a concurrent session's handoff. **Read before starting
track A or F.** Ignoring this produces two parallel conversation/activity stores
— the same failure mode the golden-record pre-audit caught and stopped.

## Who owns what

Another session owns the **AI activity spine** mission: give the estate ONE
attributed AI-activity stream, with a platform-owner (cross-tenant) lens and a
workspace-admin (own-workspace) lens — "both are the same query with a different
scope filter, once every AI action carries an actor stamp."

- Contract: `shre-dev-kit/docs/missions/ai-activity-spine.md`, branch
  `feat/ai-activity-spine-mission` (commits `4dbc058`, `8f20058`). 9 increments,
  Centrix first, Sia last.
- Their severity order for "AI work has no actor stamp":
  **Sia → AROS → MIB → RapidSupport → Centrix.**

**Track A (conversation persistence) is the AROS half of that spine.** It must
BIND to the spine's actor-stamp contract, not invent a second one. Treat this
with the same force as the standing rule against forking `canonical_entity`:
a second attribution path is a stop condition, not a design choice.

## Reference implementation — adopt HALF of it (verified first-hand, correction)

The concurrent session calls Centrix "the reference shape, not a gap"
(`server/ai-executor.ts:58–134`, `aiConversations` scoped by `workspaceId` AND
`userId`; `logAction` at `:808` writes a workspace+user audit row). **That is
right about attribution and wrong about persistence.** I read the table
definition rather than trusting the summary — `centrix/shared/schema.ts:2166`:

```ts
export const aiConversations = pgTable("ai_conversations", {
  id: varchar("id", { length: 36 }).primaryKey()…,
  workspaceId: varchar("workspace_id", …).notNull().references(() => workspaces.id…),
  userId:      varchar("user_id",      …).notNull().references(() => users.id…),
  messages:    jsonb("messages").notNull().default(sql`'[]'::jsonb`),
  lastActivity: timestamp("last_activity").notNull().defaultNow(),
  createdAt:   timestamp("created_at").notNull().defaultNow(),
});
```

With `CONVERSATION_MEMORY_LIMIT = 10` and `CONVERSATION_EXPIRY_MS = 30 * 60 *
1000` (`ai-executor.ts:48-49`), the behaviour is:

- **One row per (workspace, user)** — there is no `conversation_id` and no
  per-message row. All turns live in a single `jsonb` blob.
- **Old turns are destroyed on write**: `messages.slice(-CONVERSATION_MEMORY_
  LIMIT * 2)` keeps the last 20 and drops the rest permanently.
- **The whole row is DELETED after 30 minutes idle** (`elapsed >
  CONVERSATION_EXPIRY_MS` → `db.delete(...)`).
- Read failures are swallowed (`catch { return [] }`).

So `ai_conversations` is a **30-minute rolling context window for the model**,
not a transcript store. Copying its storage shape into AROS would rebuild the
exact gap this mission exists to close: you still could not answer "what did
users ask last week, what did we answer, and what failed."

**Ruling for track A — these are two different jobs, do not conflate them:**

1. **Adopt** the attribution shape: `workspace_id` + `user_id` NOT NULL on every
   row, FK-enforced. That is the spine's actor stamp and the half Centrix gets
   right.
2. **Reject** the storage shape. AROS needs **append-only per-message rows**
   under a `conversation_id` — never trimmed on write, never auto-deleted by a
   TTL side-effect. Retention becomes an explicit, auditable policy (and a
   deliberate PII posture), not a consequence of a cache eviction.
3. The model's context window is then **derived** from the durable rows (last N
   turns at read time), which gives Centrix's behaviour for free without making
   destruction the storage engine's default.

If track A's brief already specified a Centrix-style blob-with-TTL, that is a
**blocking correction**, not a preference.

## ✅ CLOSES the wallet lead in EVIDENCE-401-root-cause.md

That evidence note left open whether the prepaid-wallet freeze gate
(`WALLET_ENFORCE`) contributed to the 2026-07-23 401s, pending an operator read
of `/opt/aros-platform/.env`. **It did not, and no operator check is needed.**

The concurrent session verified that `aros/src/server.ts` `runUsageInvoicing`
(`:212`) and `workspaceUsageUsd` (`:1966`) read `summary.totalBilledUsd` — a
field **no version of shre-meter has ever returned** → `|| 0`. So usage
invoicing never bills and **wallet usage always reads $0**. A workspace that
always reads $0 can never freeze, so the 402 `WALLET_FROZEN` path cannot have
fired. The 401 root cause stands alone: the missing `else` on
`authenticateRequest === null`.

Corollary worth stating plainly: **AROS has never billed a single dollar of AI
usage.** That is their revenue defect to fix, not this package's — but it means
no track here may assume metering data exists. Treat `cost_events` as EMPTY.

## Hands off — owned by the other session, unmerged work in flight

Do **not** touch these; a branch `shreai/fix-meter-summary-contract` is open on
them (commits `e914d1d3c`, `e261253cc`, `0c60fc76c`, nothing merged):

- `shre-meter` (either runtime), `shre-sdk/src/cost.ts`, `toMeterEvent()`,
  `summary-range.mjs`.
- The 4 AROS billing call sites. These are **blocked on a founder decision** the
  other session raised: which shre-meter runtime is actually live. `server.mjs`
  (Express+Postgres, `/v1/events`) is what the Dockerfile ships; `src/index.ts`
  (Hono+SQLite, `/v1/costs/*`) is what the contract, docs, widget, tests, SDK
  and AROS all target. Rewriting either way before that answer is known breaks
  something.
- The port-5495 collision (`ports.json` assigns it to shre-meter; shre-deck is
  live on it and has an ACTIVE pairing session). Operator-gated cutover, not
  ours.

## Consequence for track E and track F

Track E's premise is unchanged — the chat-eval watchdog is still the only
monitoring that exists today. But note that its "eval traffic is not metering-
exempt" concern is **currently moot**, because nothing meters at all. Do not
design around a metering exemption that has no metering behind it; state the
dependency and move on.

Track F (grade real transcripts) reads whatever track A stores — so it inherits
the spine's actor stamp for free if track A binds correctly, and inherits a
second incompatible attribution model if it does not.

## Standing rule

Both missions are live in the same repos at the same time. Per the workspace
rule: **coordinate, don't collide** — re-read shared files before editing,
isolate commits, and surface a collision the moment you see one rather than
resolving it silently.
