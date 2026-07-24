# Build brief — `d-actionable-errors`: structured recovery actions in chat replies

> **Audience: Codex, with zero prior context on this repo.**
> Repo of record: GitHub `Nirlabinc/aros`. Every `path:line` below was opened and
> verified against `origin/main` at commit `9b4a693` on 2026-07-23. Line numbers
> drift — always re-open the file and match on the quoted snippet, not the number.

---

## Track

When the AROS concierge chat tells a store owner that something is broken
("RapidLab (rapidrms-api) — error: RapidRMS credentials require re-entry…"), the
reply is prose only: there is no button, no link, and the error text is cut
mid-word. This track makes any chat answer that names a broken/blocked resource
emit a **structured, server-authored, permission-gated action** that the client
renders as a button next to the message, and replaces every mid-word string cut
with a word- and grapheme-safe truncation with the full (redacted) text
available on demand.

**User-visible outcome:** Ramesh asks "which connectors are active?", gets a
deterministic honest answer with real counts, sees the failing connector named
in plain words with a readable (not mid-word-severed) error summary, and a
**"Open Connection Health"** / **"Fix this connection"** button right there in
the bubble that lands him on a page that can actually repair it. A member who
cannot repair connections is never shown the repair button — and never learns it
exists.

This implements the cross-cutting recovery contract in
`docs/journeys/get-unstuck.md` — specifically "Named, not coded", "One-tap
forward — the recovery action is on the failure screen itself", and "Dead ends
are defects".

---

## Verified ground truth

Read this whole section before touching code. Several beliefs in the original
task seed are **wrong**; the corrections are marked.

### A. The reported evidence is LLM prose, not a template — **seed correction**

The string in the bug report is exactly 80 characters at the cut, which looks
like a `slice(0, 80)`. **Do not go hunting for that slice.** It does not exist in
this repo:

- `src/server.ts:3679` — `const CONNECTOR_COLUMNS = 'id, tenant_id, type, name, config, status, last_tested, last_error, created_at, updated_at';`
- `src/server.ts:5770-5789` — `handleConnectorsList()` returns `json(res, 200, { connectors: data || [] })` with that full projection. **`last_error` is returned in full. Nothing in AROS truncates it.**
- `src/server.ts:6783-6791` — the `/v1/chat` fast-path chain is
  `handleArosHealthPing` → `handleArosAutomationChat` → `handleArosStoreDataChat`
  → `handleArosSalesChat` → `proxyRequest(req, res, SHRE_ROUTER_URL, body)`.
  **There is no connector/health intent handler.** "Which connectors are active
  on my account?" falls through to the LLM at `SHRE_ROUTER_URL`.
- `src/server.ts:4197-4207` — `isArosHealthPing()` matches connection/health/model
  *status pings* and answers with the literal string `'online'`
  (`src/server.ts:4209-4215`). It does **not** match "which connectors are active".

**UNVERIFIED:** the exact origin of the 80-char cut. It is upstream of this repo
(shre-router prompt/tool-result clamp, or an artifact of generation). *What would
verify it:* capture a full `/v1/chat` request/response pair against
`SHRE_ROUTER_URL` for the `aros-agent` lane with a tenant that has a failing
connector, and diff the tool-result payload against `tenant_connectors.last_error`.
**Do not block on this.** The fix in this brief is to stop routing that question
through the LLM at all (Step 5), which removes the mystery entirely.

### B. There IS a real, in-repo, word-unsafe truncation — fix this one

`apps/web/src/redesign/chatHistory.ts:17-21`:

```ts
  const conversation: Conversation = {
    id, title: first.length > 60 ? `${first.slice(0, 57)}…` : first,
    preview: last.replace(/```mib-widget[\s\S]*?```/g, '').trim().slice(0, 140) || 'Structured result',
    when: new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), messages: messages.slice(-50),
  };
```

Both are UTF-16 **code-unit** slices. They split surrogate pairs (emoji become
`\uFFFD`), split combining sequences, and cut mid-word. This is the concrete,
testable truncation target.

### C. Everywhere else, `last_error` is a raw untranslated passthrough

- `apps/web/src/redesign/data.ts:92` — `sub: c.last_error || (c.status === 'connected' ? 'Connected' : 'Needs attention'),` (Connectors section rows)
- `apps/web/src/redesign/data.ts:130` — `sub: c.last_error || c.last_tested || '',` (Connection Health rows)
- `apps/web/src/redesign/pages/connections/StoresPage.tsx:81` — the store row subtitle renders `${store.last_error}` verbatim.

`docs/journeys/get-unstuck.md` ("Activation dependencies") calls this a defect:
"raw upstream errors (router, POS APIs, database) must be translated at the
boundary — an unfiltered passthrough is a defect even when technically
'informative'." The client-side problem is **not** truncation; it is untranslated
passthrough into a one-line subtitle with no expand affordance.

### D. The only structured-item channel today is an in-band JSON fence

`apps/web/src/aros-ai/ChatMessageRenderer.tsx:47-61`:

```ts
const WIDGET_FENCE = /```mib-widget\s*\n([\s\S]*?)```/g;

export function extractWidgets(text: string): { cleanText: string; widgets: WidgetBlock[] } {
  const widgets: WidgetBlock[] = [];
  const cleanText = text.replace(WIDGET_FENCE, (_match, json) => {
    try {
      const parsed = JSON.parse(String(json).trim());
      if (parsed && typeof parsed.type === 'string') widgets.push(parsed);
    } catch {
      /* skip malformed */
    }
    return '';
  });
  return { cleanText: cleanText.trim(), widgets };
}
```

`WidgetBlock` at `ChatMessageRenderer.tsx:28-31` is `{ type: string; [key: string]: unknown }` —
**zero schema validation**. `CANVAS_WIDGET_TYPES = ['chart', 'table', 'metric']`
at line 45 is the allowlist that decides which widgets get an affordance.

**This channel is model-reachable.** Anything in it can be forged by the model or
by a poisoned tool result, and `ConciergeChat.tsx:115` replays the whole
transcript back into the next prompt, so a forgery persists. **Actions must NOT
ride this channel.** (Decision recorded in §Data contract.)

### E. The rendering precedent to copy

`apps/web/src/aros-ai/ChatMessageRenderer.tsx:356-369`:

```tsx
      {widgets.map((w, i) => (
        <div key={i}>
          <WidgetRenderer block={w} palette={palette} />
          {onOpenWidget && CANVAS_TYPES.has(w.type) && (
            <button
              type="button"
              onClick={() => onOpenWidget(i)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 2, fontSize: 11, color: palette.text3, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}
              title="Open on canvas"
            >
              {'⤢'} Open on canvas
            </button>
          )}
        </div>
      ))}
```

Exactly the shape to reuse: callback prop, capability-gated, inline button.

### F. The envelope seam where actions must be read

`apps/web/src/redesign/ConciergeChat.tsx:127-133`:

```ts
      // Attribution: the router returns _shre.{decisionTrace.agentId, toolsUsed, model} — surface it.
      const shre = data?._shre || data?.metadata || {};
      const agent = shre?.decisionTrace?.agentId || data?.agent || shre?.agent;
      const tools: string[] = Array.isArray(shre?.toolsUsed) ? shre.toolsUsed.map(String) : [];
      const label = agent && agent !== 'main' ? agentLabel(agent) : 'Shre';
      const model = data?.model || shre?.model;
      setMessages(prev => [...prev, { from: 'shre', text: reply, meta: model ? `${label} · ${model}` : 'Shre · Local', agent, tools }]);
```

Everything else in `_shre` is discarded today. This is the single line to extend.

### G. The client message model has no actions field

`apps/web/src/redesign/shellData.ts:55`:

```ts
export interface ChatMsg { from: 'shre' | 'me'; text: string; meta?: string; agent?: string; tools?: string[]; }
```

### H. Chat history persistence — **seed correction: nothing writes today**

- `apps/web/src/redesign/chatHistory.ts:13` exports `saveChatConversation(...)`.
- Grep across `apps/web/src/` finds **zero callers** of `saveChatConversation`.
- `apps/web/src/redesign/data.ts:509` and `:512-514` DO call `loadChatHistory(tenant?.id)` and `subscribeChatHistory(...)` to populate the History panel.

So the History panel reads a localStorage key (`aros.chat.history.v1`,
`chatHistory.ts:3`) that **nothing currently writes**. Consequence: the recon's
"actions vanish on reload" risk is real for the future but is not live today, and
**no localStorage key version bump is needed** — a defensive parse on load
(unknown/absent `actions` → `[]`) is sufficient and safer.

Recall path: `AppShell.tsx:130` — `const recall = (c: Conversation) => { setRecalled(c.messages); … }` — and `AppShell.tsx:240` mounts
`<ConciergeChat key={chatKey} … initial={recalled ?? undefined} … />`.

### I. There is no credential-repair flow to deep-link into — **critical**

- `src/server.ts:6937-6951` — the only connector routes are
  `GET /api/connectors` (6937), `POST /api/connectors` (6941),
  `POST /api/connectors/test` (6945), `DELETE /api/connectors` (6949).
  **There is no PATCH.**
- `apps/web/src/redesign/pages/connections/api.ts:92` — `updateStore()` issues
  `{ method: 'PATCH' }` against `/api/connectors`. Grep: **zero callers**, and the
  route does not exist. Dead, unbacked client code.
- `apps/web/src/redesign/pages/connections/StoresPage.tsx:81` — store rows offer
  only `Test` and `Remove` buttons.
- `supabase/migrations/20260714_tenant_connectors.sql:23-24` —
  `CONSTRAINT tenant_connectors_unique_name UNIQUE (tenant_id, name)`.
  **Correction to the recon note:** this constraint does *not* hard-block
  re-creation, because `handleConnectorsCreate` upserts —
  `src/server.ts:5825-5828`: `.upsert(payload, { onConflict: 'tenant_id,name' })`.
  So today's only repair path is "re-run the full Connect POS modal with the
  identical connection name", which silently overwrites the row (resetting
  `status` to `'pending'`, `created_by`, and clearing `last_error`) and forces the
  user to re-type the provider, name, and every config field. That is a create
  flow wearing a repair flow's hat — not a one-tap recovery, and not something a
  chat action can honestly deep-link to.

**A "Reconnect" button is a dead link until a repair route ships.** This brief
scopes that route in, as Phase B (Steps 8–11), because without it the headline
outcome is unreachable and `get-unstuck.md`'s "Dead ends are defects" is violated.

### J. Server-side RBAC has exactly one predicate

`src/server.ts:2607-2609`:

```ts
function canManageMarketplace(role: string): boolean {
  return ['owner', 'admin'].includes(role);
}
```

Used by every mutating connector route: `handleConnectorsCreate` (`src/server.ts:5794`),
`handleConnectorsDelete` (`src/server.ts:5999`). `authenticateRequest(req)` returns
`{ userId, tenantId, role, bundle }` (`src/server.ts:2595-2601`):

```ts
    return {
      userId: user.id,
      tenantId: membership.tenant_id,
      role: membership.role || 'member',
      bundle: resolveBundle(null, membership.role, SHRE_ID_PROJECT_ID),
    };
```

The fail-closed posture to copy is `handleArosAutomationChat`
(`src/server.ts:4646-4652`):

```ts
    const auth = await authenticateRequest(req);
    if (!auth || auth.tenantId !== tenantId) {
      // Fail closed: without a verified session there is no role, so no
      // rule management of any kind.
      return automationReply(res, tenantId, 'I couldn\'t verify your sign-in for this workspace, so I can\'t manage automations right now. Refresh, sign in, and try again.');
    }
```

### K. The server envelope helper to extend

`src/server.ts:4404-4410`:

```ts
function automationReply(res: ServerResponse, tenantId: string, content: string, extra: Record<string, unknown> = {}): true {
  json(res, 200, {
    content,
    _shre: { model: 'aros-automation', toolsUsed: [], mode: 'aros-automation-direct', tenantId, ...extra },
  });
  return true;
}
```

### L. The machine-routable CTA contract that already exists — **schema precedent**

`apps/web/src/redesign/data.ts:294-295`:

```ts
export type BriefCtaType = 'fix_price' | 'draft_po' | 'draft_campaign' | 'buy_review' | 'review';
export interface BriefCta { type: BriefCtaType; items: string[] }
```

Validated on receipt at `apps/web/src/redesign/data.ts:351-357`:

```ts
const BRIEF_CTA_TYPES: BriefCtaType[] = ['fix_price', 'draft_po', 'draft_campaign', 'buy_review', 'review'];

function buildBriefCta(raw: any): BriefCta | null {
  const type = raw?.type;
  if (!BRIEF_CTA_TYPES.includes(type)) return null;
  return { type, items: Array.isArray(raw?.items) ? raw.items.map(String).filter(Boolean) : [] };
}
```

Labels owned by the client at `apps/web/src/redesign/Home.tsx:100-110`, including
the governing rule in the comment:

```ts
// One primary action per CTA type. There is no in-app pricing / purchase-order
// / campaign surface yet (audited 2026-07: the shell routes are stores / apps /
// skills / agents / models / admin), so every CTA opens the digest's own rows
// in an expander inside the card — no invented pages, no dead links. When a
// real destination ships, route here instead and keep the tap recording.
const CTA_LABELS: Record<BriefCtaType, string> = {
  fix_price: 'Review pricing',
  …
```

Tap telemetry at `apps/web/src/redesign/data.ts:474-487` (`useDigestActionRecorder()`
→ `POST /api/digest/action` with `{ cta_type, items }`; the route exists at
`src/server.ts:6976`).

**Extend this family. Do not invent a parallel one.**

### M. The route table every deep link must resolve against

`apps/web/src/redesign/routes.ts:8-22` (`PATH_TO_SECTION`) and `:25-33`
(`SECTION_TO_PATH`). Verified in-shell destinations relevant here:
`/stores` → `stores`, `/connectors` → `connectors`, `/connection-health` → `health`,
`/agents` → `agents`, `/marketplace` → `marketplace`, `/notifications` → `notifications`,
`/wallet` → `wallet`, `/users` → `team`, `/billing` → `billing`.

`/connect` is **not** in `PATH_TO_SECTION` — it is a separate top-level page
(`apps/web/src/app/App.tsx:203`: `if (path === '/connect' || path.startsWith('/connect/')) {`).
Inside the shell, connecting a store is the `onConnect` callback
(`AppShell.tsx:152` `openWizard`, passed at `AppShell.tsx:240`).

### N. Navigation seams in the shell

`apps/web/src/redesign/AppShell.tsx:117-122`:

```ts
  const navigate = (nextMode: 'home' | 'chat' | 'app', nextSection?: Exclude<SectionKey, 'chat'>) => {
    const path = nextMode === 'home' ? '/dashboard' : nextMode === 'chat' ? '/chat' : SECTION_TO_PATH[nextSection ?? section] ?? '/dashboard';
    if (window.location.pathname !== path) window.history.pushState({}, '', path);
    if (nextSection) setSection(nextSection);
    setMode(nextMode);
  };
```

`goSection` at `AppShell.tsx:156-160`. `ConciergeChat` mounted at `AppShell.tsx:240`
with only `onConnect` / `onConnectApps` — proof that fix-flow callbacks already
flow into chat, but statically, not per message
(`ConciergeChat.tsx:174-177` renders those as `.aros-chip` buttons in the composer).

### O. The prose-only pointer this track replaces

`apps/web/src/redesign/ConciergeChat.tsx:34-40`:

```ts
function customerFacingReply(reply: string): string {
  const cleaned = reply.includes('</think>') ? reply.split('</think>').pop()!.trim() : reply.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  if (/\btool\s+[\w.-]+\s+failed\b|\bfailed on all paths\b|\bweb_fetch\b|\baccess control\b/i.test(cleaned)) {
    return 'I could not retrieve the connected store data for that request. The Store Operations Agent is active, but its data capability is temporarily unavailable. Check Connection Health for the affected connection, or try again in a moment.';
  }
  return cleaned;
}
```

"Check Connection Health for the affected connection" is prose today. It becomes
a button.

### P. The functional-core precedent to imitate

`apps/web/src/onboarding/readiness.ts:1-42` — pure, React-free, fetch-free,
defensive, unit-tested. Header comment states the rule:

```
 * Readiness aggregation — pure mapping from already-fetched API payloads to the
 * four readiness rows shown on the final onboarding screen. Kept free of React
 * and fetch so the status rules are unit-testable and never fabricate data
```

### Q. Test wiring — **there is a trap here**

`vitest.config.ts` (root, the ONLY vitest config in the repo — verified with
`find . -name "vitest.config*" -not -path "*/node_modules/*"`):

```ts
    include: [
      'src/**/__tests__/**/*.test.ts',
      'appfactory/**/__tests__/**/*.test.ts',
      // Pure onboarding-journey logic (framework-free, no DOM/JSX imports).
      'apps/web/src/onboarding/**/*.test.ts',
      // Pure shell logic (framework-free, no DOM/JSX imports). Add ONLY
      // framework-free *.test.ts here — DOM/JSX tests belong to Playwright.
      'apps/web/src/redesign/routes.test.ts',
      'apps/web/src/redesign/pages/connections/appsLogic.test.ts',
      'apps/web/src/redesign/pages/admin/profileLogic.test.ts',
    ],
```

**`apps/web/src/aros-ai/canvas.test.ts` exists but is NOT in this list — it never
runs.** Any new test file under `apps/web/src/` MUST be added to this `include`
array or it is dead weight. Also: root `package.json` has **no** `test` script
(only `test:auth-conformance`, `scripts` block at `package.json:11-25`). Add one.

E2E: `playwright.config.ts:11` `testDir: './e2e'`, specs mock `/api/*` at the
network layer; `e2e/` currently holds `connect-my-store.live.spec.ts`,
`install-app-from-marketplace.spec.ts`, `journey-seams.spec.ts`,
`manage-my-account.spec.ts`.

### R. Adjacent surface that lies about this exact thing (do not imitate, do not touch)

`src/human-layer.ts:287-293` `activateAllHumanConnectors()` marks every catalog
connector `'active'` in an in-memory map; `src/human-layer.ts:418-420` then emits
`` `${connectors.filter(c => c.status === 'active').length}/${connectors.length} connectors active` ``
as an alert. That is a fabricated number with no data contract. **Your handler
must read `tenant_connectors` and must not touch or reuse `human-layer.ts`.**

### S. Blast radius — four chat surfaces

| File | Reads `_shre`? | In scope this track? |
|---|---|---|
| `apps/web/src/redesign/ConciergeChat.tsx` | Yes (`:128`) | **Yes — primary** |
| `apps/web/src/aros-ai/ArosChat.tsx` | No — `:131-133` stores only `{ role, content, timestamp }` and discards the envelope | **No — CORRECTED 2026-07-24. It is not a surface: it is UNMOUNTED DEAD CODE.** See the note below. |
| `apps/web/src/pages/start/StartChat.tsx` | No | **No** — unauthenticated, so "permission-aware" = emit nothing |
| `apps/web/src/components/ChatWidget.tsx` | No | **No** — marketing site, different endpoint |

> **CORRECTION (2026-07-24, verified first-hand — this drops one of the four "surfaces").**
> `apps/web/src/aros-ai/ArosChat.tsx` is **unmounted dead code**, not a chat surface:
> - `grep -rn "ArosChat" apps/web/src` → the declaration at `ArosChat.tsx:41` plus **five comment-only mentions**. No import. No JSX usage. No mount.
> - Following the router from the app entry: `App.tsx:255` sends every onboarded authenticated route (including `/chat`) to `<AppShell />`; `App.tsx:93-95` renders the same shell auth-free at `/preview/app`; `AppShell.tsx:3` imports and `:240` mounts **`ConciergeChat`**. That is the only in-app chat a signed-in user can reach.
>
> **Step 7f is therefore REMOVED** (see §Implementation steps) and this track's client
> blast radius is **three files**, not four. Track B's Non-goal 5 ("leave it exactly as it
> is") was right; this brief's §S and Step 7f were wrong. `ArosChat.tsx` is **FROZEN for
> the whole package** — see §Collision warnings → Package file-ownership register.
> Whether it is deleted or mounted is a founder decision, raised in §Stop conditions.

### T. Journey specs

- `docs/journeys/ask-a-question-get-a-real-answer.md`, Failure states table:
  `| 2 | Store not connected yet | "I don't have your store's data yet — connect your store and I can answer that" + **Connect** button | One tap to `/connect` (journey 2) |`
  — this track is already mandated there.
- Same file, "Out of scope": `Taking actions from chat (ordering, price changes — future journeys)`.
  **Navigational fix-flow buttons are not mutations**, but the spec must be
  amended to say so explicitly (Step 13) or the journey gate in `CLAUDE.md` blocks the PR.
- `docs/journeys/get-unstuck.md` — the governing recovery contract. No change
  needed, only compliance.

---

## Depends on / blocks

**Depends on:** nothing. Every seam this track needs is already on `main`. It can
start immediately and in parallel with the other tracks in this build package.

**Blocks:** nothing hard. Any future track that wants to attach a button to a
chat reply (wallet frozen, agent not activated, app not installed, notification
destination missing) should extend `ChatActionType` in the module this track
creates rather than inventing a second channel.

**Shares files with (see §Collision warnings):**
- `apps/web/src/redesign/ConciergeChat.tsx` and
  `apps/web/src/aros-ai/ChatMessageRenderer.tsx` — co-edited by the other chat
  tracks in this package and by concurrent human/agent sessions (memory notes
  `stm_chat_composer_spec`, `stm_chat_rich_input`, `stm_voice_everywhere`, all
  `review_by 2026-08-06`).
- `src/server.ts` — hottest file in the repo (~7,000 lines; the last 10 commits
  all touch it).

---

## Data contract

### Transport decision (locked — do not re-litigate)

Actions travel in the **JSON response envelope** as `_shre.actions[]`, **not** in
an in-band ```` ```mib-action ```` fence.

Rationale, with anchors: the fence channel is parsed out of model-authored text
with `JSON.parse` and no schema validation (`ChatMessageRenderer.tsx:51-58`,
`WidgetBlock` at `:28-31`), and the full transcript is replayed into the next
prompt (`ConciergeChat.tsx:115`), so a forged action would persist and re-enter
context. This track is permission-sensitive; the emitter must be the server.

The client **re-validates on receipt** against a closed allowlist, exactly like
`buildBriefCta` (`data.ts:351-357`). The client validation is defense in depth,
**never** the permission gate.

### 1. Shared action type (server + client, kept byte-identical)

Server: `src/chat/actions.ts` (new). Client: `apps/web/src/aros-ai/actions.ts` (new).
These are two files with the same type block; there is no shared package between
`src/` and `apps/web/src/` in this repo (verified: `apps/web/package.json`
depends on `@aros/core` but `src/server.ts` is a standalone tsx entry). Add a
comment in each pointing at the other, and a test that asserts the two allowlists
are identical (Step 12).

```ts
/**
 * Chat recovery actions — the ONE structured channel by which a chat reply can
 * offer a one-tap way forward. Emitted ONLY by the server (permission decided
 * server-side); validated again on receipt. See docs/briefs/d-actionable-errors.md.
 *
 * v1 is NAVIGATIONAL ONLY: an action moves the user to a surface that can fix
 * the problem. It never mutates anything. Mutating actions from chat remain out
 * of scope per docs/journeys/ask-a-question-get-a-real-answer.md.
 */
export type ChatActionType =
  | 'open_connection_health'   // → /connection-health
  | 'open_stores'              // → /stores
  | 'reconnect_store'          // → /stores?reconnect=<resourceId>  (Phase B)
  | 'connect_store';           // → the in-shell Connect wizard (AppShell openWizard)

export interface ChatAction {
  type: ChatActionType;
  /** Opaque tenant-scoped id of the resource the action repairs (a
   *  tenant_connectors.id UUID for connector actions). Optional: page-level
   *  actions have no single resource. NEVER a secret, NEVER a credential. */
  resourceId?: string;
  /** Human name of the resource, for the button's accessible description
   *  ("RapidLab"). Already redacted + length-clamped server-side. */
  resourceLabel?: string;
}
```

**The server sends `type` + ids only. The client owns every user-visible string**
(mirroring `CTA_LABELS` at `Home.tsx:103`). This is what makes the contract
tamper-resistant and translatable.

### 2. Client label + destination table (`apps/web/src/aros-ai/actions.ts`)

```ts
export interface ChatActionPresentation {
  label: string;
  /** In-shell path; must be a key of PATH_TO_SECTION in redesign/routes.ts,
   *  or null when the action is a callback (the Connect wizard). */
  path: string | null;
}

export const CHAT_ACTION_TYPES: ChatActionType[] = [
  'open_connection_health', 'open_stores', 'reconnect_store', 'connect_store',
];

/**
 * Types minted CLIENT-side only; the server never emits them. Ships EMPTY from
 * this track. Track `b-auth-401-recovery` appends its four recovery types
 * ('reauth' | 'switch_workspace' | 'retry_turn' | 'open_wallet') here when it
 * extends the union — that is what keeps the server⊆client parity test honest
 * instead of forcing a deep-equal that B would have to break. See Step 12.
 *
 * OWNERSHIP: this file is created by track D and EXTENDED by track B. One file,
 * one union, never a parallel type. Order: D → B(client steps 4-8).
 */
export const CLIENT_ONLY_ACTION_TYPES: ChatActionType[] = [];

export const CHAT_ACTION_PRESENTATION: Record<ChatActionType, ChatActionPresentation> = {
  open_connection_health: { label: 'Open Connection Health', path: '/connection-health' },
  open_stores:            { label: 'Open Stores',            path: '/stores' },
  reconnect_store:        { label: 'Reconnect',              path: '/stores' },
  connect_store:          { label: 'Connect a store',        path: null },
};

/** Validate-on-receipt. Unknown types are DROPPED, never rendered. */
export function buildChatActions(raw: unknown): ChatAction[] { /* see Step 3 */ }
```

### 3. `_shre` envelope (server → client)

Existing shape, unchanged except for the new optional field:

```jsonc
{
  "content": "…the reply text…",
  "_shre": {
    "model": "aros-connector-health",
    "toolsUsed": ["tenant_connectors"],
    "mode": "aros-connector-health-direct",
    "tenantId": "<uuid>",
    "actions": [                          // NEW — optional, may be absent or []
      { "type": "reconnect_store", "resourceId": "<uuid>", "resourceLabel": "RapidLab" },
      { "type": "open_connection_health" }
    ]
  }
}
```

Hard rules:
- `actions` is **absent or `[]`** unless the server has verified the caller's role.
- Max **3** actions per reply (`MAX_CHAT_ACTIONS = 3`). Emit the most specific first.
- `resourceLabel` is clamped to 40 grapheme clusters via the truncation core and
  passed through the redactor before it leaves the server.

### 4. `ChatMsg` extension (`apps/web/src/redesign/shellData.ts:55`)

```ts
export interface ChatMsg { from: 'shre' | 'me'; text: string; meta?: string; agent?: string; tools?: string[]; actions?: ChatAction[]; }
```

`actions` is optional, so legacy localStorage rows parse fine — see §H. **No
`aros.chat.history.v1` key version bump.** `buildChatActions(undefined)` returns
`[]`.

### 5. Truncation core (`apps/web/src/aros-ai/truncate.ts`, new)

```ts
export interface TruncateResult { text: string; truncated: boolean }

/**
 * Word- and grapheme-safe truncation. `max` counts grapheme CLUSTERS, not
 * UTF-16 code units, so emoji and combining marks are never split. When the cut
 * lands inside a word, backs up to the previous whitespace boundary — unless
 * that would drop more than 25% of the budget (long unbroken tokens, e.g. a
 * URL), in which case it cuts at the grapheme boundary.
 * Appends '…' only when something was actually removed.
 */
export function truncateText(input: string, max: number): TruncateResult;
```

Implementation notes for Codex:
- Prefer `Intl.Segmenter` (`new Intl.Segmenter(undefined, { granularity: 'grapheme' })`).
  Node 20+ and every browser AROS targets have it; the repo requires
  `"node": ">=20.0.0"` (`package.json:8-10`).
- Provide a fallback using `Array.from(input)` (code points) when
  `Intl.Segmenter` is undefined, so tests never depend on ICU availability.
- Pure. No React, no DOM, no fetch. Never throws — a non-string input returns
  `{ text: '', truncated: false }`.

### 6. Redaction core (`src/chat/redact.ts`, new — server side only)

> **THIS FILE IS THE PACKAGE'S ONE PAN REDACTOR.** Three briefs originally each
> declared their own (A §4.2 `redactPan`, D here, F §Data contract 3
> `redactPii`) and the semantics diverged: A Luhn-gated, D and F a bare
> 13–19-digit run — D's rule would have redacted A's own negative-test fixture
> `'2026072420260724'`. Three redactors is three chances to leak a card number,
> and forking a shared safety primitive is a standing stop condition in this
> house. **Resolved: one location, one signature, one set of semantics, one
> fixture file.** `src/chat/redact.ts` is the owner; A imports from it, F mirrors
> it across the `.ts`/`.mjs` boundary with a parity test — the same pattern this
> track already uses for `truncateText`.
>
> **Whoever lands first creates the file** (declared order is C → D → I → A, so
> normally this track). If `src/chat/redact.ts` already exists when you get here,
> **do not redeclare `redactPan` or the fixture file** — import them and add only
> what your track is missing. Any change to `redactPan`'s semantics after it
> lands is a founder-level change, not a refactor: it must update the fixture
> file and both mirrors in the same PR.

#### 6a. `redactPan` — the shared primitive (PCI)

```ts
/**
 * Replace Luhn-valid 13–19 digit runs with PAN_REDACTION_MARKER.
 *
 * THE single PAN redactor for this repo (server + eval mirror). PCI: a PAN must
 * never be stored, logged, displayed or returned. Pure, total, idempotent.
 */
export const PAN_REDACTION_MARKER = '[redacted-card]';
export function redactPan(text: string): string;
export function isLuhnValid(digits: string): boolean;   // exported for the mirror's parity test
```

**Semantics — normative, mirrored verbatim in `.mjs`:**

1. **Candidate scan** — `/(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g`. That is 13–19
   digits, where digits may be separated by a **single space or hyphen** (no
   commas, dots or slashes — those are what keep `$1,234,567.89` intact), and the
   run is not adjacent to another digit.
2. **Luhn gate** — strip `[ -]` from the candidate; if the remaining string is
   13–19 digits **and** passes the Luhn check, replace the **whole matched run**
   (digits *and* its internal separators) with `PAN_REDACTION_MARKER`. If Luhn
   fails, the candidate is returned **byte-identical**.
3. **Idempotent** — the marker contains no digits, so
   `redactPan(redactPan(x)) === redactPan(x)` holds by construction. Assert it
   anyway.
4. **Total** — a non-string input returns `''`; the function never throws.
5. **No other rule lives here.** `redactPan` does exactly one thing.

**Why Luhn-gated and not "any long digit run" — this does not weaken PCI.**
Every real PAN carries an ISO/IEC 7812-1 check digit, so **every PAN passes
Luhn**; gating cannot let a genuine card number through. What it buys is that
the redactor stops destroying the retail numbers this whole package exists to
observe — business dates, order ids, timestamps concatenated by a log formatter.
A redactor that eats ground truth gets turned off, and a redactor that is off
leaks everything.

**Shared fixture file — `src/chat/__fixtures__/pan-redaction.json` (create it here).**
One list, consumed by *both* mirrors' tests, so drift fails a test instead of
leaking a card:

```jsonc
{
  "note": "Canonical PAN-redaction fixtures. Consumed by src/chat/__tests__/redact.test.ts (vitest), src/__tests__/chat-transcript.test.ts (track A) and scripts/chat-eval/transcript-core.test.mjs (track F, node:test). Luhn validity of every entry was computed, not assumed. Editing this file changes a security primitive — update all mirrors in the same PR.",
  "redacted": [
    "card 4111111111111111 declined",
    "4111-1111-1111-1111",
    "4111 1111 1111 1111",
    "invoice-4111111111111111.",
    "378282246310005",
    "6011000990139424",
    "4111111111119",
    "6212345678901234569"
  ],
  "unchanged": [
    "Total Sales: $1,234,567.89",
    "business date 2026-07-24",
    "call 5551234567",
    "order 9876543210",
    "sku 123456789012",
    "2026072420260724",
    "ref 12345678901234567890 end",
    "Connection timed out after 30s"
  ]
}
```

Every entry above was checked against the stated algorithm before it was
written down: `4111111111119` (13), `378282246310005` (15),
`6212345678901234569` (19) are Luhn-**valid**; `2026072420260724` (16, the
date-pair fixture) and `1234567890123456789` are Luhn-**invalid**; the 20-digit
run in `"ref 1234…7890 end"` matches no candidate at all (a 20-digit run cannot
satisfy the `(?<!\d)`/`(?!\d)` boundaries), which is why it belongs in
`unchanged` rather than being left unspecified.

**Test contract (both mirrors):** every string in `redacted` must contain
`PAN_REDACTION_MARKER`, must not contain any of its original digit runs, and
must survive a `/(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/` scan of the *output* with
zero Luhn-valid matches; every string in `unchanged` must come back
**`===` byte-identical**.

#### 6b. `redactUpstreamError` — this track's boundary translator

```ts
/**
 * Boundary translation for raw upstream error text before it can reach a user
 * surface (docs/journeys/get-unstuck.md: "raw upstream errors must be translated
 * at the boundary"). Pure, no I/O. COMPOSES redactPan — it does not
 * re-implement a digit rule.
 */
export function redactUpstreamError(raw: string): string;
```

Order of operations:

1. **`redactPan(raw)` first.** The PCI guard runs before any other
   digit-preserving rule and is the *only* digit rule in this function.
2. Then replace, case-insensitively, with the fixed marker `'[redacted]'`:
   - `Bearer <token>` / `Authorization: …`
   - `password=…`, `pwd=…`, `pass=…`, `secret=…`, `token=…`, `apikey=…`, `api_key=…`
     (up to the next whitespace, `&`, `"`, or `'`)
   - JWT-shaped strings: `eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}`
   - Connection strings: `(postgres|postgresql|mysql|mssql|mongodb|redis)://[^\s]+`
   - Any bare hex/base64 run of ≥ 32 characters.
3. Then collapse whitespace and clamp with `truncateText`.

Note the deliberate consequence of step 1: a 13–19-digit run that **fails** Luhn
(an order id, a concatenated timestamp) now survives into the error string. That
is the intended trade — see the rationale in §6a — and it is why the benign
fixture `'Connection timed out after 30s'` still round-trips unchanged.

### 7. Connector→action derivation core (`src/chat/connectorActions.ts`, new)

Pure, rules-as-data, in the shape of `apps/web/src/onboarding/readiness.ts`.

```ts
/** The projection this core reads — a strict subset of CONNECTOR_COLUMNS
 *  (src/server.ts:3679). Deliberately excludes config and credentials_encrypted. */
export interface ConnectorRowLike {
  id?: string | null;
  type?: string | null;
  name?: string | null;
  status?: string | null;       // 'pending'|'connected'|'disconnected'|'error'
  last_error?: string | null;
  last_tested?: string | null;
}

export interface ConnectorHealthLine {
  label: string;         // "RapidLab (RapidRMS)"
  state: 'healthy' | 'attention' | 'down';
  /** Redacted + truncated one-line summary; '' when there is nothing to say. */
  summary: string;
  /** True when summary was cut — the client offers "Show full detail". */
  truncated: boolean;
  /** Full redacted text, for the expand affordance. Never the raw string. */
  detail: string;
}

export interface ConnectorHealthAnswer {
  /** Deterministic prose. Counts are computed here from real rows only. */
  content: string;
  lines: ConnectorHealthLine[];
  actions: ChatAction[];
}

/** `canManage` is the caller's verified permission — the CALLER passes it in;
 *  this function never looks up a role. */
export function buildConnectorHealthAnswer(
  rows: ConnectorRowLike[],
  canManage: boolean,
): ConnectorHealthAnswer;
```

**Declarative rule table** (this is the "rules as data" requirement):

```ts
const CONNECTOR_ACTION_RULES: Array<{
  status: 'pending' | 'connected' | 'disconnected' | 'error';
  state: ConnectorHealthLine['state'];
  /** Emitted only when the caller can manage connectors. */
  manageAction: ChatActionType | null;
  /** Emitted for everyone (read-only destination). */
  viewAction: ChatActionType | null;
}> = [
  { status: 'error',        state: 'down',      manageAction: 'reconnect_store', viewAction: 'open_connection_health' },
  { status: 'disconnected', state: 'down',      manageAction: 'reconnect_store', viewAction: 'open_connection_health' },
  { status: 'pending',      state: 'attention', manageAction: 'open_stores',     viewAction: 'open_connection_health' },
  { status: 'connected',    state: 'healthy',   manageAction: null,              viewAction: null },
];
```

Zero rows → `content` states honestly that no connectors are configured and, when
`canManage`, emits `connect_store`; when not, emits nothing and says an owner or
admin can connect one.

**No number without a data contract:** every count in `content` is
`rows.filter(...).length`. Never a catalog length, never a constant. Do not
import anything from `src/human-layer.ts`.

### 8. Phase B — credential repair route

**Request** — `PATCH /api/connectors`, authenticated, `Content-Type: application/json`:

```jsonc
{
  "id": "<tenant_connectors.id uuid>",
  "secrets": { "email": "…", "password": "…" }   // provider-specific; same field
                                                  // keys handleConnectorsCreate accepts
}
```

- `name`, `type` and `config` are **not** editable by this route in v1 (avoids the
  `UNIQUE (tenant_id, name)` collision entirely).
- Response `200`: `{ "connector": { …CONNECTOR_COLUMNS projection… }, "result": { "success": true } }`.
  The projection **never** includes `credentials_encrypted` (matches
  `handleConnectorsList`, `src/server.ts:5776-5783`).
- `401` when `!auth`; `403 { "error": "Owner or admin role required" }` when
  `!canManageMarketplace(auth.role)` — byte-identical to
  `handleConnectorsCreate` (`src/server.ts:5794`).
- `404` when the row does not exist **for this tenant** (`.eq('tenant_id', auth.tenantId)`).
- On a failed re-test: `200` with `result.success === false` and the row's
  `status` left at `'error'` with a **redacted** `last_error` — the UI keeps the
  typed values and shows the honest reason (`get-unstuck.md`: "Preserve
  everything typed").
- Audit on success, mirroring `src/server.ts:6016-6023`:

```ts
    await auditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: 'connector.credentials_updated',
      resource: id,
      detail: {},          // NEVER the secrets, NEVER any field of them
      ip: getClientIp(req),
    });
```

**No migration is required.** `tenant_connectors` already has every column
needed: `credentials_encrypted`, `status`, `last_tested`, `last_error`,
`updated_at` (`supabase/migrations/20260714_tenant_connectors.sql:6-25`), RLS is
already `ENABLE`d service-role-only (`:32`), and the status `CHECK` already
allows all four values (`:21-22`). **If you find yourself writing a migration for
this track, stop** — see §Stop conditions.

For completeness, the RLS posture you are binding to (already merged, do not
re-declare):

```sql
-- supabase/migrations/20260714_tenant_connectors.sql:30-32
-- Service-role access only: the AROS server reads/writes on behalf of
-- authenticated tenant members. No direct client access to credential blobs.
ALTER TABLE public.tenant_connectors ENABLE ROW LEVEL SECURITY;
```

Tenant isolation is enforced in the handler by `.eq('tenant_id', auth.tenantId)`
on **every** query, exactly as `handleConnectorsList` (`src/server.ts:5779`) and
`handleConnectorsDelete` (`src/server.ts:6008`) do.

---

## Implementation steps

Phase A (Steps 1–7, 12–14) delivers the action contract end to end.
Phase B (Steps 8–11) delivers the repair destination that makes the headline
action non-dead. **Ship Phase A and Phase B in the same PR** — Phase A alone
puts a `reconnect_store` button on screen with nowhere real to go.

If you must split: in a Phase-A-only PR, delete `'reconnect_store'` from
`CHAT_ACTION_TYPES` and from `CONNECTOR_ACTION_RULES` (both `manageAction` values
become `'open_stores'`). Never ship a button whose destination cannot perform the fix.

### Phase A — the action contract

**Step 1 — pure truncation core.** *(parallelizable with Steps 2, 3)*
Create `apps/web/src/aros-ai/truncate.ts` per §Data contract §5. Pure, no imports
from React/DOM. Create `apps/web/src/aros-ai/truncate.test.ts`.

**Step 2 — pure redaction core.** *(parallelizable with 1, 3)*
Create `src/chat/redact.ts` per §Data contract §6 — **both** `redactPan` (§6a,
the package's single PAN primitive, consumed by tracks A and F) and
`redactUpstreamError` (§6b, which composes it). Also create the shared fixture
file `src/chat/__fixtures__/pan-redaction.json` verbatim from §6a. Pure, no
imports from `src/server.ts`.
**If `src/chat/redact.ts` already exists** (track A landed first), import
`redactPan` from it and add only `redactUpstreamError` — do not declare a second
PAN rule and do not edit the fixture file's expectations.
It needs a truncation helper: **copy** `truncateText` into
`src/chat/truncate.ts` (identical implementation; `src/` and `apps/web/src/` do
not share a module graph) and add a test asserting the two files' exported
behaviour matches on a shared fixture list (Step 12).

**Step 3 — the shared action type + client presentation table.** *(parallelizable with 1, 2)*
- Create `src/chat/actions.ts` — the `ChatActionType` union, `ChatAction`
  interface, `CHAT_ACTION_TYPES` array, `MAX_CHAT_ACTIONS = 3`.
- Create `apps/web/src/aros-ai/actions.ts` — the same type block, plus
  `CHAT_ACTION_PRESENTATION` and:

```ts
export function buildChatActions(raw: unknown): ChatAction[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatAction[] = [];
  for (const item of raw) {
    const type = (item as any)?.type;
    if (!CHAT_ACTION_TYPES.includes(type)) continue;           // drop unknowns
    const resourceId = (item as any)?.resourceId;
    const resourceLabel = (item as any)?.resourceLabel;
    out.push({
      type,
      ...(typeof resourceId === 'string' && resourceId ? { resourceId } : {}),
      ...(typeof resourceLabel === 'string' && resourceLabel
        ? { resourceLabel: truncateText(String(resourceLabel), 40).text }
        : {}),
    });
    if (out.length >= MAX_CHAT_ACTIONS) break;
  }
  return out;
}
```

Also export a link-validity helper so the route table can be unit-asserted:

```ts
export function actionPath(type: ChatActionType): string | null {
  return CHAT_ACTION_PRESENTATION[type].path;
}
```

**Step 4 — render contract in the shared renderer.**
`apps/web/src/aros-ai/ChatMessageRenderer.tsx`:
- Add props `actions?: ChatAction[]` and `onAction?: (action: ChatAction) => void`
  to the component's prop type.
- After the `widgets.map(...)` block (currently ends at line 369), render an
  action row **copying the shape of the existing "Open on canvas" button**
  (`ChatMessageRenderer.tsx:359-368`) but as a visible affordance:

```tsx
      {onAction && actions && actions.length > 0 && (
        <div className="aros-msgacts">
          {actions.map((a, i) => (
            <button key={`${a.type}:${i}`} type="button" className="aros-chip" onClick={() => onAction(a)}
              aria-label={a.resourceLabel ? `${CHAT_ACTION_PRESENTATION[a.type].label} — ${a.resourceLabel}` : CHAT_ACTION_PRESENTATION[a.type].label}>
              {/* The <span> is load-bearing, not decoration: the ellipsis rule below
                  targets `.aros-chip > span`. A bare text child has no box to clip,
                  so without this wrapper the overflow protection is inert. */}
              <span>{CHAT_ACTION_PRESENTATION[a.type].label}</span>
            </button>
          ))}
        </div>
      )}
```

- Add to `apps/web/src/app/aros-shell.css`, immediately after the `.aros-chips`
  rule at line 142 (which already uses `flex-wrap: wrap`):

```css
.aros-msgacts { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
.aros-msgacts .aros-chip { max-width: 100%; }
/* Requires the <span> wrapper in the JSX above — `text-overflow` needs a block
   formatting context with a constrained width, which a bare text node does not have.
   `min-width: 0` is what actually lets a flex/grid child shrink below its content
   size; without it `max-width: 100%` alone will not clip a single long word. */
.aros-msgacts .aros-chip > span { display: block; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
```

**Reviewer check (this is a real regression trap):** render a chip whose label is 200
characters, at a 320px viewport, and assert both that the ellipsis is visible **and**
`document.documentElement.scrollWidth <= clientWidth`. If you changed the JSX to drop the
`<span>`, this rule silently stops applying and the assertion is the only thing that
notices.

`flex-wrap: wrap` + `max-width: 100%` is what keeps a long label from pushing
horizontal page scroll inside `.aros-msg__bubble` (`aros-shell.css:126-130`).
**Zero horizontal page scroll at 320–1440px in both orientations is a hard
requirement** (root `CLAUDE.md`, App Build Standards).

**Step 5 — the deterministic connector-health handler (server).**
Create `src/chat/connectorHealth.ts` (new file — **do not write this inline in
`src/server.ts`**; that file is ~7,000 lines and the hottest in the repo). Export:

```ts
export function isArosConnectorHealthQuestion(text: string): boolean;
export async function handleArosConnectorHealthChat(
  req: IncomingMessage, res: ServerResponse, body: Record<string, unknown> | null,
  deps: {
    isArosChatContext: (req: IncomingMessage, body: Record<string, unknown> | null) => boolean;
    chatLatestText: (body: Record<string, unknown> | null) => string;
    arosChatTenant: (req: IncomingMessage, body: Record<string, unknown> | null) => string;
    authenticateRequest: (req: IncomingMessage) => Promise<{ userId: string; tenantId: string; role: string } | null>;
    canManageMarketplace: (role: string) => boolean;
    createSupabaseAdmin: () => any;
    /** RESOLVED 2026-07-24 — track C lands FIRST in the /v1/chat block and makes
     *  `arosChatJson` the single reply choke point for the deterministic AROS
     *  handlers. Every 200 reply from this handler goes through it, NOT through
     *  a bare `json(res, 200, …)`. See Step 6's sequencing note. */
    arosChatJson: (res: ServerResponse, content: string, shre: Record<string, unknown>) => void;
    /** Non-200 replies only. Never used for the 200 path. */
    json: (res: ServerResponse, code: number, payload: unknown) => void;
  },
): Promise<boolean>;
```

Passing the seams in as `deps` keeps the new module free of a circular import
back into `server.ts` and keeps the diff on `server.ts` to a handful of lines.

Matcher discipline — copy the narrow, negated-keyword style of `isArosSalesChat`
(`src/server.ts:4225-4230`) and **fall through on ambiguity**:

```ts
const CONNECTOR_NOUN = /\b(connector|connectors|connection|connections|integration|integrations|store connection|pos connection)\b/i;
const HEALTH_VERB   = /\b(active|connected|working|broken|failing|failed|down|status|health|healthy|list|which|what|how many|show)\b/i;
// Negated: anything the sales / store-data / automation lanes own, plus
// anything that reads as a request to CHANGE something.
const NOT_CONNECTOR = /\b(sales?|revenue|inventory|stock|invoice|edi|labor|payroll|add|create|delete|remove|disconnect|set up|setup|configure|alert|notify|text me|email me)\b/i;

export function isArosConnectorHealthQuestion(text: string): boolean {
  const t = text.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (NOT_CONNECTOR.test(t)) return false;
  return CONNECTOR_NOUN.test(t) && HEALTH_VERB.test(t);
}
```

Handler body, in order — **every guard fails closed by returning `false`**
(fall through to the LLM lane) **except the authenticated-role guard**, which
answers honestly:

1. `if (!deps.isArosChatContext(req, body)) return false;`
2. `if (!isArosConnectorHealthQuestion(deps.chatLatestText(body))) return false;`
3. `const tenantId = deps.arosChatTenant(req, body); if (!UUID_RE.test(tenantId)) return false;`
   (export `UUID_RE` from `src/server.ts:3789`, or re-declare the identical regex
   in the new module — do not weaken it.)
4. `const auth = await deps.authenticateRequest(req);`
   `if (!auth || auth.tenantId !== tenantId)` → reply with the honest
   sign-in sentence and `actions: []` (mirror `src/server.ts:4646-4652`), return `true`.
5. Query — exactly this projection, tenant-scoped:

```ts
const { data, error } = await deps.createSupabaseAdmin()
  .from('tenant_connectors')
  .select('id, type, name, status, last_error, last_tested')
  .eq('tenant_id', auth.tenantId)
  .order('created_at', { ascending: true });
```

   On `error`: **return `false`** (fall through to the LLM). Never answer with a
   fabricated count.
6. `const answer = buildConnectorHealthAnswer(rows, deps.canManageMarketplace(auth.role));`
7. Respond in the existing envelope shape (`src/server.ts:4404-4410`):

```ts
deps.json(res, 200, {
  content: answer.content,
  _shre: {
    model: 'aros-connector-health',
    toolsUsed: ['tenant_connectors'],
    mode: 'aros-connector-health-direct',
    tenantId,
    actions: answer.actions,
  },
});
return true;
```

**Step 6 — wire the handler into the chain (2-line diff on `src/server.ts`).**

> **SEQUENCING — RESOLVED 2026-07-24. Four tracks rewrite these nine lines.**
> Declared package merge order for the `/v1/chat` dispatch block is
> **C → D → I → A** (§Collision warnings → Package file-ownership register).
> **Track C lands before you.** By the time you edit the block, track
> `c-honest-data-contract` has introduced `arosChatJson(res, content, shre, p?)`
> as the single reply choke point for the deterministic handlers, and C's own
> review criterion is *"`grep -n "json(res, 200" src/server.ts` shows no direct
> call inside lines ~4200-4930."* Your handler is a deterministic AROS handler,
> so it must not reintroduce one.
>
> **Two concrete consequences for this track:**
> 1. In the `deps` object of `handleArosConnectorHealthChat` (§Data contract),
>    **replace `json` with `arosChatJson`**: `arosChatJson: (res, content, shre) => void`.
>    Every reply your handler emits — the honest sign-in reply in guard 4 and the
>    connector-health answer — goes through it, so the provenance footer and the
>    shared reply gate apply to your handler for free. Keep `json` in `deps` **only**
>    if you emit a non-200 status; the 200 path must use `arosChatJson`.
> 2. Track **I** lands after you (a new `exceptions` branch inside
>    `handleArosStoreDataChat`) and track **A** lands last (it wraps every handler
>    line in a `captureJsonResponse` shim). Neither disturbs your line, but **do not
>    rebase your snippet over theirs** — re-read `:6783` region immediately before
>    committing, as this brief's own collision table already says.

At `src/server.ts:6783-6791`, insert **after** `handleArosHealthPing` and
**before** `handleArosAutomationChat`:

```ts
    if (await handleArosConnectorHealthChat(req, res, body, chatDeps)) return;
```

plus the import at the top of the file and a `const chatDeps = { … }` object
built once near the other module-level constants. Placement rationale, matching
the existing comment at `:6784-6785`: the health *ping* is narrower and must stay
first; the connector question must be matched before automation, because
"disconnect the RapidRMS connector" is negated by `NOT_CONNECTOR` and belongs to
the automation/LLM lane.

**Step 7 — client: read, persist, and route the actions.**

a) `apps/web/src/redesign/shellData.ts:55` — add `actions?: ChatAction[]` to
   `ChatMsg` and import the type from `../aros-ai/actions`.

b) `apps/web/src/redesign/ConciergeChat.tsx:127-133` — extend the envelope read:

```ts
      const actions = buildChatActions(shre?.actions);
      setMessages(prev => [...prev, { from: 'shre', text: reply, meta: model ? `${label} · ${model}` : 'Shre · Local', agent, tools, actions }]);
```

c) `ConciergeChat.tsx:47` — add an `onAction?: (action: ChatAction) => void` prop
   to the component signature.

d) `ConciergeChat.tsx:152-154` — pass through to the renderer:

```tsx
                {m.from === 'me' ? m.text : <ChatMessageRenderer content={m.text} palette={palette} actions={m.actions} onAction={onAction} />}
```

e) `apps/web/src/redesign/AppShell.tsx` — add the handler near `goSection`
   (`:156-160`) and pass it at the `ConciergeChat` mount (`:240`):

```ts
  const onChatAction = (action: ChatAction) => {
    if (action.type === 'connect_store') { openWizard(); return; }
    if (action.type === 'reconnect_store' && action.resourceId) {
      setReconnectConnectorId(action.resourceId);   // consumed by StoresPage, Step 11
      navigate('app', 'stores');
      return;
    }
    const path = actionPath(action.type);
    const section = path ? PATH_TO_SECTION[path] : undefined;
    if (section) navigate('app', section);
  };
```

   Import `PATH_TO_SECTION` from `./routes`. **In-app `navigate()`, never
   `window.location.href`** — a full page reload loses the transcript.

f) ~~`apps/web/src/aros-ai/ArosChat.tsx:131-133` — adopt the same contract in the
   FAB widget…~~ **REMOVED 2026-07-24. Do not do this step.**
   `ArosChat.tsx` is not "not mounted inside `AppShell`" — it is **not mounted
   anywhere**: no import, no JSX usage, zero render paths (see the correction in
   §S). Extending it would ship a `window.location.assign(...)` navigation and a
   second `onAction` convention into a component no user can reach, and **no
   acceptance test in §3 could drive it** — which is precisely why it must not
   ship. It also contradicts track B's Non-goal 5, which is correct.
   **The file is FROZEN for the whole package** (§Collision warnings → Package
   file-ownership register). This track's client edits are 7a–7e only:
   `shellData.ts`, `ConciergeChat.tsx`, `ChatMessageRenderer.tsx`, `AppShell.tsx`.

### Phase B — the repair destination

**Step 8 — `PATCH /api/connectors` handler.**
In `src/server.ts`, add `handleConnectorsUpdate(req, res)` between
`handleConnectorsTest` (`src/server.ts:5861`) and `handleConnectorsDelete`
(`src/server.ts:5996`) — those two are adjacent today, so the new function slots
cleanly between them. Structure it as an exact sibling of
`handleConnectorsDelete` (`src/server.ts:5996-6029`):

1. `const auth = await authenticateRequest(req); if (!auth) return json(res, 401, { error: 'Authentication required' });`
2. `if (!canManageMarketplace(auth.role)) return json(res, 403, { error: 'Owner or admin role required' });`
3. Parse body; require `id` (UUID) and a non-empty `secrets` object. `400` otherwise.
4. Load the row with `.eq('tenant_id', auth.tenantId).eq('id', id)` → `404` if absent.
5. Re-encrypt the new secrets with the **same two calls** `handleConnectorsCreate`
   makes (`src/server.ts:5811` and `:5818`):

```ts
    ensureConnectorCrypto();                                   // src/server.ts:3682
    const credentials_encrypted = encryptValue(JSON.stringify(secrets));
```

   Do not write a second crypto path and do not change `ensureConnectorCrypto`
   or `encryptValue`.
6. Run the same connectivity test `handleConnectorsTest` runs.
7. Update the row: `credentials_encrypted`, `status` (`'connected'` on success,
   `'error'` on failure), `last_tested = new Date().toISOString()`,
   `last_error` (`null` on success, else `redactUpstreamError(msg)`),
   `updated_at`. **Never** touch `name`, `type`, or `tenant_id`.
8. `storeSummaryCache.delete(auth.tenantId);` (as `handleConnectorsTest` does at `src/server.ts:5962` and `handleConnectorsDelete` at `src/server.ts:6014`).
9. `auditLog({ … action: 'connector.credentials_updated', resource: id, detail: {} … })` — see §Data contract §8.
10. Respond `{ connector: <CONNECTOR_COLUMNS projection>, result: { success } }`.

**Step 9 — route it.** `src/server.ts:6937-6951` — add between the `POST` and
`/test` blocks:

```ts
  if (pathname === '/api/connectors' && method === 'PATCH') {
    return handleConnectorsUpdate(req, res);
  }
```

**Step 10 — make the dead client function real.**
`apps/web/src/redesign/pages/connections/api.ts:92` — narrow `updateStore` to the
route that now exists:

```ts
export async function reconnectStore(auth: AuthScope, id: string, secrets: Record<string, string>): Promise<StoreConnector> {
  const result = await request<{ connector: StoreConnector }>('/api/connectors', auth, { method: 'PATCH', body: JSON.stringify({ id, secrets }) });
  return result.connector;
}
```

Delete the old `updateStore` — it has zero callers (verified) and its
`name`/`description`/`accessMode` fields are not supported by the new route.

**Step 11 — Reconnect affordance on `/stores`.**
`apps/web/src/redesign/pages/connections/StoresPage.tsx:81` — in the store row,
add a **Reconnect** button beside `Test` and `Remove`, shown only when
`store.status !== 'connected'`. It opens the existing connect modal (already in
this file, `StoresPage.tsx:83`) in "reconnect" mode: provider and name are fixed
and read-only, only the secret fields are editable, submit calls `reconnectStore`.
Accept a `reconnectId?: string` prop from `AppShell` (Step 7e) and auto-open the
modal for that row on mount.

Also on this page, replace the raw `store.last_error` render in the subtitle with
`truncateText(store.last_error, 100)` plus a "Show full detail" disclosure that
reveals the whole (already server-redacted) string. Same treatment at
`apps/web/src/redesign/data.ts:92` and `:130`.

**On a failed reconnect, the typed values stay in the form** — `get-unstuck.md`,
"Preserve everything typed".

### Cross-cutting

**Step 12 — truncation fix + test wiring.**
- `apps/web/src/redesign/chatHistory.ts:18-19` — replace both code-unit slices:

```ts
    id, title: truncateText(first, 60).text,
    preview: truncateText(last.replace(/```mib-widget[\s\S]*?```/g, '').trim(), 140).text || 'Structured result',
```

  (`truncateText` already appends `…` only when it actually cut — drop the
  hand-rolled `length > 60 ? … : first` ternary.)
- **`vitest.config.ts`** — add every new `apps/web/src/**` test file to the
  `include` array. It is an explicit allowlist, and
  `apps/web/src/aros-ai/canvas.test.ts` is currently orphaned because it was
  never added. Add:

```ts
      'apps/web/src/aros-ai/truncate.test.ts',
      'apps/web/src/aros-ai/actions.test.ts',
      'apps/web/src/aros-ai/canvas.test.ts',        // pre-existing, never ran
```

  (`src/chat/**/__tests__/*.test.ts` is already covered by the existing
  `'src/**/__tests__/**/*.test.ts'` entry.)
- `package.json:11-25` — add the settled test scripts. **Do not write `"test": "vitest run"`;
  that value is wrong and would delete track F's `node:test` suite from CI.**

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

**For this track specifically:** if the suite is red, append this track's files to
`test:unit` —
`apps/web/src/aros-ai/truncate.test.ts apps/web/src/aros-ai/actions.test.ts src/chat/__tests__/redact.test.ts src/chat/__tests__/connectorActions.test.ts src/chat/__tests__/connectorHealthMatcher.test.ts src/chat/__tests__/truncateParity.test.ts src/__tests__/connectors-update-scope.test.ts`
— and note that the `vitest.config.ts` `include` additions above are still required either
way (an explicit file list on the CLI does not remove the allowlist requirement for the
default run).

**Step 13 — journey spec update (required by the journey gate).**
`docs/journeys/ask-a-question-get-a-real-answer.md`:
- "Out of scope" currently reads
  `Taking actions from chat (ordering, price changes — future journeys), …`.
  Amend to distinguish mutations from navigation, e.g.
  `Taking MUTATING actions from chat (ordering, price changes — future journeys). Navigational recovery actions — a one-tap link from a chat answer to the surface that fixes a named broken resource — are IN scope and governed by docs/journeys/get-unstuck.md.`
- Add a failure-state row for the broken-connector case:
  `| 2 | A named connector is failing | The connector named in plain words + a readable one-line reason + a **Reconnect** / **Open Connection Health** button (owners/admins see Reconnect; members see the read-only view) | One tap to /stores or /connection-health |`

`CLAUDE.md` ("Journey gate") requires the spec update **and** a golden-path E2E
in the same PR.

**Step 14 — tap telemetry.**
Reuse the existing ledger seam rather than adding a new one: fire-and-forget
`POST /api/digest/action` with `{ cta_type: 'chat_action:' + action.type, items: [action.resourceId ?? ''] }`
from `onChatAction`, copying the never-throw, never-await, never-in-demo shape of
`useDigestActionRecorder` (`apps/web/src/redesign/data.ts:474-487`; the server
route is at `src/server.ts:6976`). If the upstream ledger rejects the prefixed
type, **do not invent a new table** — drop this step and note it. See §Stop conditions.

**Parallelism summary:** Steps 1, 2, 3 are independent. Step 4 needs 1+3. Step 5
needs 2+3. Step 6 needs 5. Step 7 needs 3+4. Steps 8–10 are independent of Phase A
and can run concurrently. Step 11 needs 10. Step 12 needs 1. Steps 13, 14 last.

---

## Acceptance tests

All commands run from the repo root
(`C:/Users/nirpa/.shre/worktrees/aros/chat-observability` in this working copy).

### 1. Pure unit tests — `npx vitest run`

**`apps/web/src/aros-ai/truncate.test.ts`**

| Case | Input | Expected |
|---|---|---|
| No cut needed | `truncateText('hello', 20)` | `{ text: 'hello', truncated: false }` |
| Word boundary | `truncateText('RapidRMS credentials require re-entry after provisioning', 40)` | `text` ends on a whole word, `text` has no trailing partial token, `truncated === true`, ends with `…` |
| Grapheme safety (emoji) | `truncateText('ok 👨‍👩‍👧‍👦 done', 5)` | `text` contains no `\uFFFD`; `Array.from(result.text)` never ends mid-surrogate |
| Combining marks | `truncateText('café' + '\u0301'.repeat(3) + ' more', 5)` | no orphaned combining mark at the end |
| Long unbroken token | `truncateText('https://example.com/a/very/long/path/that/never/breaks', 20)` | cuts at the grapheme boundary (does not return `''`), `truncated === true` |
| Regression, the real bug | `truncateText('RapidRMS credentials require re-entry after Verifone provisioning collision repair', 80).text` | does **NOT** end with `'repa'` |
| Defensive | `truncateText(undefined as any, 10)` | `{ text: '', truncated: false }`, no throw |

**`apps/web/src/aros-ai/actions.test.ts`**

- `buildChatActions(undefined)` / `(null)` / `('nope')` / `({})` → `[]` (no throw).
- `buildChatActions([{ type: 'not_a_real_type' }])` → `[]` — **unknown types are dropped.**
- `buildChatActions([{ type: 'open_stores' }])` → `[{ type: 'open_stores' }]`.
- Over-long `resourceLabel` (200 chars) → clamped to ≤ 40 graphemes + `…`.
- More than 3 valid actions → exactly 3 returned.
- **Link validity (the "no dead links" rule from `Home.tsx:100-102`):** for every
  `t` in `CHAT_ACTION_TYPES`, `actionPath(t)` is either `null` or a key of
  `PATH_TO_SECTION` imported from `../redesign/routes`. This is the test that
  makes a dead link impossible to merge. **Keep this invariant exactly as
  written — do not widen it** (RESOLVED 2026-07-24: track B's draft had
  `reauth → path: '/login'`, and `/login` is *not* a key of `PATH_TO_SECTION`
  — verified `apps/web/src/redesign/routes.ts:8-22`; `/login` is a top-level page
  outside the shell, like `/connect`. **B changes `reauth` to `path: null` + a
  callback**, consistent with its own `switch_workspace` and `retry_turn` rows
  and with its Step 7e, which already requires reauth to persist the transcript
  *and then* navigate — i.e. a callback, not a plain link. With that change the
  invariant holds unchanged for all eight types.)
- `CHAT_ACTION_PRESENTATION` has an entry for every member of `CHAT_ACTION_TYPES`
  and every `label` is non-empty.

**`src/chat/__tests__/redact.test.ts`**

- `redactUpstreamError('login failed for user a@b.com password=hunter2 retry')`
  contains neither `hunter2` nor `password=`.
- A JWT fixture (`eyJhbGciOi….….…`) is fully replaced.
- **PCI — driven by the shared fixture file, not by hand-written strings.**
  Load `src/chat/__fixtures__/pan-redaction.json` and, for every entry in
  `redacted`, assert `redactPan(entry)` contains `PAN_REDACTION_MARKER` and the
  output has **zero Luhn-valid** matches of
  `/(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g`; for every entry in `unchanged`, assert
  `redactPan(entry) === entry`. Assert idempotence over both lists.
  Do **not** assert a bare `/\b\d{13,19}\b/` scan comes back empty — that is the
  pre-Luhn rule and the `unchanged` fixtures deliberately keep long digit runs.
- **Composition:** `redactUpstreamError('card 4111111111111111 declined')` does
  not contain `4111111111111111` — i.e. §6b's step 1 actually calls §6a.
- `redactUpstreamError('postgres://u:p@host:5432/db timed out')` drops the URL.
- A benign message (`'Connection timed out after 30s'`) is returned unchanged
  except for whitespace collapsing — the redactor must not destroy useful signal.

**`src/chat/__tests__/connectorActions.test.ts`** — the core of the track.

Fixtures (plain objects, no DB, no network):

```ts
const rows = [
  { id: 'a1', type: 'rapidrms-api',       name: 'RapidLab',  status: 'error',
    last_error: 'RapidRMS credentials require re-entry after Verifone provisioning collision repair; token=abcdef1234567890abcdef1234567890' },
  { id: 'b2', type: 'verifone-commander', name: 'Harbor',    status: 'connected', last_error: null },
  { id: 'c3', type: 'rapidrms-api',       name: 'Five Points', status: 'pending', last_error: null },
];
```

| Assertion | Why |
|---|---|
| `buildConnectorHealthAnswer(rows, true).content` contains `'1'` connected and `'3'` total, computed from `rows` | "No number without a verified data contract" |
| `buildConnectorHealthAnswer([], true).content` names zero connectors and emits `connect_store` | honest empty state |
| `buildConnectorHealthAnswer([], false).actions` → `[]` | members get no fix affordance |
| `buildConnectorHealthAnswer(rows, true).actions.some(a => a.type === 'reconnect_store' && a.resourceId === 'a1')` | the failing row gets a targeted action |
| **`buildConnectorHealthAnswer(rows, false).actions.every(a => a.type !== 'reconnect_store')`** | **permission gate — the member-vs-owner test** |
| `buildConnectorHealthAnswer(rows, false).content` does not contain the word `Reconnect` or any instruction only an owner could follow | do not leak the existence of an owner-only fix |
| No `line.summary` or `line.detail` contains `abcdef1234567890abcdef1234567890` | redaction runs before the text leaves the core |
| No `line.summary` ends mid-word (assert the last token is also a token of `line.detail`) | the headline truncation bug |
| `actions.length <= 3` for a 20-row fixture with 12 failures | `MAX_CHAT_ACTIONS` |
| `buildConnectorHealthAnswer(rows, true)` called twice returns deep-equal results | pure |
| Rows with `status: 'weird_unknown_value'` produce a line but **no** action | rule table falls through safely |

**`src/chat/__tests__/connectorHealthMatcher.test.ts`**

Must match: `'Which connectors are active on my account?'`,
`'are my connections working'`, `'show me connector status'`,
`'is my store connection down'`.
Must **not** match (falls through to the LLM/other lanes):
`'how were sales yesterday'`, `'text me when a connector fails'`,
`'add a new connector'`, `'disconnect RapidRMS'`, `'what is my inventory'`, `''`.
Also assert `isArosConnectorHealthQuestion` agrees with itself on the same string
with different casing/whitespace.

**`src/chat/__tests__/truncateParity.test.ts`**
For a shared fixture list (≥ 15 strings incl. emoji, CJK, URLs, the RapidRMS
error), `src/chat/truncate.ts` and `apps/web/src/aros-ai/truncate.ts` return
identical `{ text, truncated }`. This is what keeps the two copies from drifting.

**Action-union parity — CORRECTED 2026-07-24. Assert SUBSET, not equality.**
The original line ("`CHAT_ACTION_TYPES` in `src/chat/actions.ts` deep-equals the
one in `apps/web/src/aros-ai/actions.ts`") **is false the moment track
`b-auth-401-recovery` lands.** B adds four **client-only** recovery types —
`reauth`, `switch_workspace`, `retry_turn`, `open_wallet` — minted entirely
client-side from an HTTP failure. B states explicitly that *the server never
sends them*. The client union is therefore a **deliberate strict superset**, and
a deep-equal assertion would either fail CI or force B to fork the type. Assert
the invariant that actually matters:

```ts
import { CHAT_ACTION_TYPES as SERVER_TYPES } from '../actions';                       // src/chat/actions.ts
import { CHAT_ACTION_TYPES as CLIENT_TYPES,
         CLIENT_ONLY_ACTION_TYPES } from '../../../apps/web/src/aros-ai/actions';

// 1. Every type the SERVER can emit must be renderable by the client.
for (const t of SERVER_TYPES) assert.ok(CLIENT_TYPES.includes(t), `client cannot render ${t}`);

// 2. Every client type NOT in the server union must be declared client-only —
//    this is what stops a real drift from hiding behind "it's a superset".
for (const t of CLIENT_TYPES) {
  if (!SERVER_TYPES.includes(t)) assert.ok(CLIENT_ONLY_ACTION_TYPES.includes(t), `undeclared client type ${t}`);
}

// 3. No overlap: a client-only type must never be emittable by the server.
for (const t of CLIENT_ONLY_ACTION_TYPES) assert.ok(!SERVER_TYPES.includes(t), `${t} is claimed by both sides`);
```

Add `export const CLIENT_ONLY_ACTION_TYPES: ChatActionType[] = [];` to
`apps/web/src/aros-ai/actions.ts` in Step 2 — **this track ships it empty** (all
four of D's types are server-emitted). Track B fills it with its four types when
it extends the union. Ownership of the file: **this track (D) creates it, B
extends it** — see §Collision warnings → Package file-ownership register.

### 2. Tenant-isolation / RLS negative test — `npx vitest run src/__tests__/`

No migration ships in this track, so there is no new RLS policy to test. What
**must** be tested is that the new PATCH route is tenant-scoped. Follow the
existing pattern in `src/__tests__/` (see `src/__tests__/auth-conformance.test.ts`
for how this repo fakes `createSupabaseAdmin`).

Add `src/__tests__/connectors-update-scope.test.ts` with a stubbed Supabase
client that records the query chain:

- Calling `handleConnectorsUpdate` with `auth.tenantId = 'T1'` and a connector id
  belonging to `T2` issues a query whose filters include **both**
  `('tenant_id', 'T1')` and `('id', <id>)`, and the stub returning zero rows
  produces an HTTP **404** — never a 200, never a cross-tenant write.
- With `auth.role = 'member'`, the handler returns **403** and the Supabase stub
  is **never called** (assert call count === 0).
- With `auth = null`, returns **401**, stub never called.
- On success, `auditLog` is called with `action: 'connector.credentials_updated'`
  and a `detail` object that, JSON-stringified, contains none of the submitted
  secret values.

Live cross-tenant read check (read-only, allowed): with two tenants' access
tokens, `GET /api/connectors` returns only that tenant's rows —
`src/server.ts:5779` `.eq('tenant_id', auth.tenantId)` is the guard. Run against
a **non-production** environment only.

### 3. Golden-path E2E — `npx playwright test e2e/get-unstuck-from-chat.spec.ts`

New spec in `e2e/`, following the network-mocking style of the existing specs
(`playwright.config.ts:17-19`; base URL defaults to the locally started web app).

> **Entry point — `/preview/app`, NOT `/chat`. The spec cannot pass otherwise.**
> Verified on `origin/main` @ `9b4a693`: `apps/web/src/app/App.tsx:92-95` returns
> `<AppShell />` for any path starting `/preview/app` **before any auth check**. Every
> other shell path (including `/chat`) falls through `<ProtectedRoute>` (`:224-228`) and
> then the `!onboarded` redirect (`:235-242`), so an unauthenticated Playwright run never
> reaches the composer — it lands on `/login`. All four existing specs use `/preview/app`
> for exactly this reason, and `e2e/install-app-from-marketplace.spec.ts:7` states it in
> the file. `/preview/app` mounts the same `<ConciergeChat>` through `AppShell.tsx:240`,
> so this is the real component and the real renderer, not a stand-in.
>
> **Two consequences for the assertions below, do not skip them:**
> - **Step 6's `/stores` navigation still works** — `/preview/app` is the shell, and
>   in-shell section routing is what `PATH_TO_SECTION` drives. Assert the section
>   rendered, not merely `page.url()`, because demo/preview mode treats every embedded
>   app as installed (`AppShell.tsx:96`) and a URL alone would not prove the panel opened.
> - **The member-vs-owner split cannot come from a real session** in local mode. Drive it
>   from the mocked `/v1/chat` envelope only — which is already how this test is written,
>   and is legitimate: the permission decision is made server-side by
>   `buildConnectorHealthAnswer(rows, isManager)` and is unit-tested directly in
>   Acceptance §1. The E2E proves the *rendering* of each envelope, not the gate.
>
> If a future change makes an authenticated shell reachable in CI, this spec may move to
> `/chat`. Until then, a spec pointed at `/chat` is a spec that never runs its assertions.

**Owner path:**
1. `page.route('**/api/connectors', …)` → one `rapidrms-api` row named `RapidLab`
   with `status: 'error'` and a long `last_error`.
2. `page.route('**/v1/chat', …)` → the envelope from §Data contract §3 including
   `actions: [{ type: 'reconnect_store', resourceId: 'a1', resourceLabel: 'RapidLab' }]`.
3. Go to **`/preview/app`**, open the chat pane, type "Which connectors are active on my
   account?", submit.
4. Assert the reply bubble is visible **and** a button named `Reconnect` is
   visible inside it.
5. Assert the visible error summary does **not** end with a partial word — take
   the rendered text and assert its final token is a complete word from the
   fixture (a regex over the fixture's word list).
6. Click `Reconnect`. Assert `page.url()` ends with `/stores` and the reconnect
   modal is open with `RapidLab` prefilled and read-only.
7. Assert **no horizontal page scroll** at 320px:
   `await page.setViewportSize({ width: 320, height: 800 })`, then
   `expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)`.
   Repeat at 768 and 1440, and in landscape (`{ width: 800, height: 320 }`).

**Member path (the permission proof):**
Same, but the mocked `/v1/chat` envelope carries
`actions: [{ type: 'open_connection_health' }]` (which is what the server
produces for a non-manager). Assert **no** element with the accessible name
`Reconnect` exists anywhere on the page, and that the reply text does not contain
the word `Reconnect`.

### 4. Live smoke (read-only; run against beta/QA, **not** production)

```
node scripts/journey-walk.mjs --base <beta-url>
```

Then, with a beta owner session, POST to `/v1/chat` with
`{"agentId":"aros-agent","messages":[{"role":"user","content":"Which connectors are active on my account?"}],"stream":false}`
and assert:
- HTTP 200 with `_shre.mode === 'aros-connector-health-direct'` (i.e. the
  fast-path matched — **not** the LLM),
- `_shre.actions` is an array, each `type` in `CHAT_ACTION_TYPES`,
- the counts in `content` match `GET /api/connectors` for the same session,
- no substring of `content` matches `/\b\d{13,19}\b/` or `/eyJ[A-Za-z0-9_-]{10,}\./`.

**Do not run this against production and do not attempt any login** — an account
lockout risk is live (track E).

### 5. Typecheck / lint

```
pnpm typecheck
pnpm lint
```

---

## Non-goals

Do **not** touch any of the following in this track:

1. **The `mib-widget` fence contract.** `extractWidgets`
   (`ChatMessageRenderer.tsx:47-61`), `CANVAS_WIDGET_TYPES` (`:45`), `canvas.ts`,
   `CanvasContext.tsx`, `DataCanvasPanel.tsx`, `Canvas.tsx`. Actions do not ride
   this channel and must not change how widgets are parsed or rendered.
2. **Mutating actions from chat.** No "reconnect now" that performs the repair
   inline, no price changes, no orders. Actions are navigation only.
   (`docs/journeys/ask-a-question-get-a-real-answer.md`, Out of scope.)
3. **`src/human-layer.ts`.** Its fabricated `N/N connectors active` alert
   (`:418-420`) is a separate defect. Do not fix it, do not import from it, do
   not let it become a data source.
4. **The golden-record layer.** `canonical_entity`, `entity_alias`,
   `canonical_strong_key`, `merge_candidate`, `negative_pair`, `merge_event`,
   `resolveCanonical()`, `src/golden/store.ts` `createGoldenStore()`. This track
   never resolves an identity. A second identity-resolution path is an automatic stop.
5. **`apps/web/src/pages/start/StartChat.tsx`** (pre-auth) and
   **`apps/web/src/components/ChatWidget.tsx`** (marketing site). Unauthenticated
   surfaces emit no actions by construction.
6. **Role bundles enforcement.** `src/auth/role-bundle.ts` / `resolveBundle` are
   carried on `auth` (`src/server.ts:2600`) but not enforced anywhere. v1 gates on
   `canManageMarketplace(auth.role)` only. Do not start enforcing bundles here.
7. **Any new database migration.** Every column needed already exists — see
   §Data contract §8.
8. **shre-router / the `shreai` repo.** Everything in this track lands in `aros`.
9. **The other tracks' concerns:** streaming/latency, chat-eval scoring changes,
   composer icons, voice.
10. **`apps/web/src/aros-ai/ArosChat.tsx` — anything at all.** It is unmounted dead
    code (§S correction) and is frozen for the entire package. Do not add auth
    headers to it, do not add actions to it, do not delete it. Track B's
    Non-goal 5 says the same thing and is the authority here.

---

## Collision warnings

### Package file-ownership register (RESOLVED 2026-07-24 — authoritative, identical in every brief)

This brief was written package-blind — it warned about "other tracks" without
naming one. The eight sibling briefs live beside it in `docs/briefs/`. **One
owning track per contested file. The arrows are a merge order, not a preference.**

| File | OWNER (creates / restructures) | Merge order | Rule for non-owners |
|---|---|---|---|
| `src/server.ts` `/v1/chat` dispatch block (`:6783-6792`) | **C** (`c-honest-data-contract`) — introduces `arosChatJson()` | **C → D → I → A** | **You are second.** Your 5th handler emits through `arosChatJson` (Step 6 note). Track **I** then adds an `exceptions` branch inside `handleArosStoreDataChat`; track **A** lands last and wraps every handler line in a capture shim. |
| `src/server.ts` `proxyRequest` (`:948-1034`) | **B** (`b-auth-401-recovery`) steps 1–3 | **B(1–3) → A** | Different region — not your edit, and not the same as the dispatch block. |
| `apps/web/src/aros-ai/actions.ts` (NEW) | **THIS TRACK (D)** — you create the file, `ChatActionType`, `CHAT_ACTION_TYPES`, `CLIENT_ONLY_ACTION_TYPES`, `CHAT_ACTION_PRESENTATION`, `buildChatActions`, `actionPath` | **D → B(client steps 4–8)** | B **extends** the union with four client-only recovery types and appends them to `CLIENT_ONLY_ACTION_TYPES`. B's `reauth` row is `path: null` + callback, so your link-validity invariant holds unchanged. Never a parallel type, never a second file. |
| `apps/web/src/redesign/shellData.ts:55` (`ChatMsg.actions`) | **THIS TRACK (D)** | **D → B** | One optional field, added once, by you. B imports it. |
| `apps/web/src/redesign/ConciergeChat.tsx` | shared — **B** rewrites the failure half of `send()`, **C** reads `_shre` on the success half, **you** add the `actions` read + `onAction` prop, **A** adds a `conversationIdRef` | **B → C → D → A** | All four edit the same ~40 lines. Land serially; re-read the file immediately before each edit. |
| `apps/web/src/aros-ai/ArosChat.tsx` | **NOBODY — FROZEN** | — | Verified unmounted dead code. Your Step 7f is **removed** (§S correction). Track B's Non-goal 5 is the authority. Delete-or-mount is a founder decision — §Stop conditions #8. |
| `scripts/chat-eval/triage.mjs` + `triage-core.mjs` | **E** (structural) | **E → F** | Not this track. |
| `scripts/chat-eval/core.mjs` | **F** steps 3–4 | **F → C(step 10)** | Not this track. |
| `src/chat/redact.ts` + `src/chat/__fixtures__/pan-redaction.json` (NEW) | **THIS TRACK (D)** — §Data contract 6a: the package's **one** PAN redactor (`redactPan`, Luhn-gated) + the shared fixture list; §6b `redactUpstreamError` composes it | **D → A**; F mirrors | You own it, so write it to be consumed: `redactPan` and `PAN_REDACTION_MARKER` are exported, the fixture file is the single source of test truth, and `redactUpstreamError` must contain **no digit rule of its own**. A imports it, F mirrors it verbatim into `.mjs` with a parity test, G/H import it for `entity_note.body`. If A landed first, import what exists — never a second PAN rule. |
| `public.platform_settings` DDL | `supabase/migrations/20260723_platform_settings.sql:9-15` | — | Not this track (Non-goal 7: no migration). |

**Globally satisfiable merge order for `src/server.ts`:**
**B(1–3) → C(step 3) → D → I → A(migration + steps 4–11) → F(6,7,9,10).**
Inside `scripts/chat-eval/`: **E → F(3,4,5) → C(step 10) → F(6,7,9,10)**.

---

| File | Who else touches it | How to sequence |
|---|---|---|
| `src/server.ts` (~7,000 lines) | **Hottest file in the repo** — the last 10 commits all touch it. **Named siblings: C owns the `/v1/chat` reply choke point and lands before you; I adds an `exceptions` branch after you; A wraps the whole chain last.** | Keep all new logic in `src/chat/*.ts`. Your diff on `server.ts` must be: 1 import, 1 `chatDeps` const, 1 line in the `/v1/chat` chain (`:6783-6791`), 1 handler function + 1 route line for PATCH (`:6937-6951`). Rebase, re-read `:6783-6791` and `:6937-6951` before the final commit — the line numbers **will** have moved. |
| `apps/web/src/redesign/ConciergeChat.tsx` | Other chat tracks in this package + concurrent sessions (memory: `stm_chat_composer_spec`, `stm_chat_rich_input`, `stm_voice_everywhere`, all `review_by 2026-08-06`). Recently changed by `a07c9dc` (composer icons, PR #201). | Your changes are 4 surgical edits (§Step 7 a–d), all in the `send()` envelope read (`:127-133`), the props line (`:47`), and the bubble render (`:152-154`). Do **not** reformat, do not reorder imports, do not touch the composer JSX at `:173-197`. |
| `apps/web/src/aros-ai/ChatMessageRenderer.tsx` | Same set. (It is *nominally* shared between two chat surfaces — in fact only `ConciergeChat` renders it, because `ArosChat` is never mounted.) | Add props and one JSX block **after** the existing `widgets.map` (`:356-369`). Do not modify `extractWidgets`, `WidgetBlock`, `CANVAS_WIDGET_TYPES`, or the markdown component overrides (`:342-349`). |
| `apps/web/src/app/aros-shell.css` | Composer/mobile tracks. | Append the `.aros-msgacts` rules directly after `.aros-chip__dot` (`:150`). Do not edit `.aros-chip`, `.aros-chips`, `.aros-msg__bubble`, or `.aros-inputrow`. |
| `apps/web/src/redesign/AppShell.tsx` | Nav/drawer work. | Add `onChatAction` next to `goSection` (`:156-160`) and one prop at the mount (`:240`). Do not restructure `navigate` (`:117-122`). |
| `vitest.config.ts` | Every track that adds a test. | Append to the `include` array — never reorder or remove existing entries. Expect a trivial merge conflict here; resolve by keeping **both** sides' additions. |
| **`package.json` `"scripts"`** | **Tracks C (step 12), D (step 12, this one) and F (step 0) all add a `"test"` script.** Each brief originally prescribed a *different* value, so whoever landed second would have silently deleted the other's suite from CI. **Settled:** the exact two-line value is written byte-identically in all three briefs (see step 12). | **Run `jq -r '.scripts.test' package.json` before editing.** Already the settled string ⇒ another track landed first; assert it and change nothing. Anything else ⇒ **stop and reconcile**, never overwrite. Only `test:unit` may be appended to (append-only, never rewritten). |
| `docs/journeys/ask-a-question-get-a-real-answer.md` | Possibly other chat tracks amending the same spec. | Edit only the "Out of scope" paragraph and add one row to the "Failure states" table. |

**Git discipline (non-negotiable):** never run branch-switching or tree-mutating
git commands in `C:/Users/nirpa/Documents/Projects/aros` — concurrent sessions
are live on it. Work in a dedicated worktree under
`~/.shre/worktrees/aros/<branch-slug>` (`shre-dev-kit scripts/worktree.ps1`), and
read other refs with `git show origin/main:<path>`.

---

## Rollback

The track is designed so each layer degrades independently.

**Level 1 — kill the actions without a deploy.** Add an env gate in
`src/chat/connectorHealth.ts`: when `AROS_CHAT_ACTIONS === 'off'`, emit
`actions: []` (the prose answer stays). The client already renders nothing for an
empty array (`onAction && actions && actions.length > 0`, §Step 4). Set the var
in `/opt/aros-platform/.env` and restart the pm2 process **with founder
approval** — that box is a hand-managed fork (see `DEPLOY-LOG.md` on the box).

**Level 2 — revert the fast-path only.** Remove the single line
`if (await handleArosConnectorHealthChat(req, res, body, chatDeps)) return;` from
the `/v1/chat` chain (`src/server.ts:6783-6791`). Connector questions go back to
the LLM lane exactly as today. Everything else (truncation fix, PATCH route,
Reconnect button) keeps working.

**Level 3 — revert the client.** `git revert` the commits touching
`ConciergeChat.tsx`, `ChatMessageRenderer.tsx`, `AppShell.tsx`,
`shellData.ts`, `aros-shell.css`. Because `actions` is an **optional** field on
`ChatMsg` and nothing writes `aros.chat.history.v1` today (§H), reverting leaves
no orphaned persisted state and no key migration.

**Level 4 — revert Phase B.** Remove the PATCH route line
(`src/server.ts:6937-6951`) and `handleConnectorsUpdate`. The route 404s; the
`Reconnect` button must be removed in the same revert (see the Phase-A-only note
at the top of §Implementation steps) so no dead link ships.

**Nothing to roll back in the database.** No migration, no schema change, no
backfill. `connector.credentials_updated` rows in `audit_log` are append-only
history and are safe to leave.

---

## Stop conditions — come back to the founder, do not assume

1. **Phase B cannot be done safely.** The intended reuse is
   `ensureConnectorCrypto()` + `encryptValue(JSON.stringify(secrets))`
   (`src/server.ts:5811`, `:5818`). If those cannot be called from an update path
   as-is, **stop**. Do not write a second crypto path and do not store secrets any
   other way.
2. **You find yourself writing a database migration.** §Data contract §8 says
   none is needed. If you believe one is, the design has drifted — stop and
   confirm. If a migration is genuinely approved, RLS policies ship in the *same*
   migration file, and a cross-tenant-read-returns-zero-rows test ships with it.
3. **The connector-health fast-path changes `scripts/chat-eval/battery.json`
   results.** That battery has a `connectors` case
   (`"question": "Which connectors are active on my account?"`,
   `"latencyBudgetMs": 5000`, `"checks": { "expectAnyFrom": "connectorNames" }`).
   A deterministic handler changes what that case measures. If the eval score
   moves, report it — do not silently retune the battery.
4. **A member (non-owner/admin) can reach a `reconnect_store` action** in any
   test, or the server emits actions without a verified session. That is a
   permission leak — stop and report before shipping.
5. **Redaction would destroy the message's usefulness** (e.g. every real POS error
   your fixtures contain gets fully replaced). The rule set needs founder input on
   the redaction/utility tradeoff; do not ship a redactor that turns every error
   into `[redacted]`. **And: `redactPan` (§6a) is a shared safety primitive used
   by tracks A and F. If you conclude its semantics must change, stop — that is a
   package-wide change (fixture file + both mirrors, one PR), never a local
   tweak, and never a second redactor.**
6. **`POST /api/digest/action` rejects the `chat_action:` prefixed `cta_type`**
   (Step 14). Do not create a new telemetry table or endpoint — drop the
   telemetry step and report.
7. **Scope creep into other resource kinds.** Wallet-frozen
   (`isWorkspaceFrozen`, defined `src/server.ts:2160`, used `src/server.ts:989`),
   unactivated agents (`/agents`), uninstalled marketplace apps (`/marketplace`),
   missing notification destinations (`/notifications`, already pointed at in
   prose by `AUTOMATION_PREFS_HINT`, `src/server.ts:4412`) each need their own
   verified status contract. **v1 is
   connectors only.** If asked to add another, confirm the data contract first.
8. **Any change would touch the golden-record layer** or introduce a second
   identity-resolution path. Automatic stop.
9. **Deploying, restarting, or pushing.** This brief authorizes code changes and
   local/beta verification only. Production deploys, service restarts, and
   external publishing need explicit founder confirmation. `app.aros.live` is a
   hand-managed pm2 fork whose truth is `DEPLOY-LOG.md` on the box — assume prod
   is **not** identical to `origin/main`.
10. **Any test needs a production credential or a login.** An account-lockout risk
    is live. Read-only probes of live surfaces are fine; logins are not.

11. **[FOUNDER DECISION — BLOCKING for anyone who wants to touch `ArosChat.tsx`;
    NOT blocking for this track] What happens to `apps/web/src/aros-ai/ArosChat.tsx`?**

    **The facts, verified 2026-07-24 against `origin/main` in the worktree:** the
    file declares `export function ArosChat()` at `:41` and is referenced nowhere
    but in five comments. No import, no JSX usage, no route. Following the router
    from the app entry: `App.tsx:255` sends every onboarded authenticated route
    (`/chat` included) to `<AppShell />`, `App.tsx:93-95` renders the same shell
    auth-free at `/preview/app`, and `AppShell.tsx:3,:240` mounts **`ConciergeChat`**.
    A user cannot reach `ArosChat` by any path. Yet it is ~330 lines that
    `a07c9dc` (PR #201, one commit old) actively maintained, it carries the
    `aros-chat-messages` localStorage cache, and `CanvasContext.tsx` still
    documents its two-tree relationship with the canvas.

    **The three options are:**
    - **(a) Delete it** — removes ~330 lines of maintained-but-unreachable code and
      the four stale comments that point at it. Cheapest to reason about; loses
      whatever it was being kept for.
    - **(b) Mount it** — if the floating widget is still a wanted product surface,
      it needs a route/host, a session (it sends **no** `Authorization` header
      today, `:120-127`), and a journey spec. That is its own track, not a
      side-effect of this one.
    - **(c) Freeze it as-is** — the status quo, with an explicit `@deprecated
      — not mounted` header comment so the next reader is not misled the way
      three briefs in this package were.

    **What has already been decided for this package (no founder input needed):**
    **no track edits the file.** D's Step 7f is removed, A's Step 9 ArosChat half
    is removed, B's Non-goal 5 stands. Every brief now says the same thing.

    **Recommendation: (c) now, (a) after a founder confirms nothing off-repo
    imports it.** Freezing costs nothing and unblocks all nine tracks today;
    deleting is a separate one-line-per-comment cleanup PR that should not be
    bundled with a permission-sensitive track. Do **not** choose (b) inside this
    mission — a new mounted chat surface would need its own journey spec under
    `.claude/JOURNEY_GATE.md`, and the "AI activity spine" work in
    `COORDINATION-ai-activity-spine.md` would inherit a second attribution
    surface it has not been designed for.
