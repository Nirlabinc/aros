# Track B — Session/passport expiry auto-recovery

Slug: `b-auth-401-recovery`
Repos of record: `Nirlabinc/aros` (primary), `Nirlabinc/shreai` (read-only for this track)
Written for an executor with **zero prior context on this codebase**. Every claim below
carries a `path:line` anchor that was opened and read on `origin/main` at authoring time
(2026-07-23). Where a line number is cited, it is the line as it exists on aros
`origin/main` commit `9b4a693` / shreai working checkout.

---

## Track

**What:** When the AROS concierge chat gets an authentication failure from the
`/v1/chat` hop, it currently shows the literal string `I couldn't complete that request
(HTTP 401). Try again in a moment.`, throws away the user's typed message, and leaves an
orphan user bubble in the transcript. Retrying can never fix it. This track makes that
failure recover itself where it can, and name itself honestly where it cannot.

**Why:** On 2026-07-23, six of twelve chat questions on the founder's own account
returned HTTP 401 `{"error":"Invalid or expired passport","code":"INVALID_TOKEN"}`.
The full root-cause trace is already written up beside this brief at
`docs/briefs/EVIDENCE-401-root-cause.md` — read it first; this brief is the fix design
that follows from it.

**User-visible outcome (this is the acceptance bar):**

1. A recoverable auth failure (expired Supabase session) is repaired silently: the user
   sees a slightly longer in-flight state, then their answer. They never learn a 401
   happened.
2. An unrecoverable auth failure names itself in plain words and carries **one tap
   forward** — "Sign in again", "Switch workspace", "Add funds" — not "try again".
3. On **every** failure the typed message is back in the composer and the orphan user
   bubble is gone.
4. The string `HTTP 401` (or any bare `HTTP <n>`) can never again reach a chat bubble.
5. The replay cannot double-charge, double-answer, or double-write.

This satisfies `docs/journeys/get-unstuck.md:22` ("Named, not coded — `500`,
`ECONNREFUSED`, raw JSON — each of these has shipped to users and each is a defect"),
`:24` ("Preserve everything typed — a failed submit never clears the form"), `:25`
("One-tap forward — the recovery action is on the failure screen itself"), `:27`
("Dead ends are defects"), and `:46-48` ("raw upstream errors (router, POS APIs,
database) must be translated at the boundary — an unfiltered passthrough is a defect").

---

## Verified ground truth

### 0. Orientation — the three processes involved

| Process | Repo / path | What it is |
|---|---|---|
| Browser SPA | `aros` → `apps/web/` | Vite + React. The chat UI. |
| aros-platform | `aros` → `src/server.ts` (7214 lines) | Node built-in HTTP server on port 5457. Serves the SPA **and** proxies `/v1/*` to shre-router. This is `app.aros.live`. |
| shre-router | `shreai` → `shre-router/src/` | Hono app. Owns model routing, the tool loop, cost recording. Speaks **passport JWTs only**. |

`shre-passport` is a fourth service that mints passports. **Its source is not checked out
locally** (`C:/Users/nirpa/Documents/Projects/shreai/shre-passport` is an empty
directory — verified by `ls`). Nothing in this track needs to read it.

### 1. The browser never holds a passport — this is the load-bearing correction

The seed for this track said "shre-passport issues the token [to the user]". **It does
not.** The browser sends its **Supabase** `access_token`:

`apps/web/src/redesign/ConciergeChat.tsx:104-110` (the whole send fetch):

```ts
const res = await fetch(`${ROUTER_URL}/v1/chat`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json', 'x-channel': 'aros',
    ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    ...(tenant?.id ? { 'x-tenant-id': tenant.id, 'x-aros-tenant-id': tenant.id, 'X-Workspace-ID': tenant.id } : {}),
  },
```

`ROUTER_URL` defaults to `''` (`ConciergeChat.tsx:21`), so this is a **same-origin**
request that lands on aros-platform, not on shre-router directly.

Passports are minted **server-side by aros-platform**, two kinds:

- A shared service passport for the identity `aros-platform`
  (`src/server.ts:823-852`): minted at boot and re-minted every 30 minutes
  (`setInterval(… , 30 * 60 * 1000)` at `:851`), `ttlSeconds: 7200` (`:836`).
  Inert unless **both** `SHRE_PASSPORT_URL` and `PASSPORT_ADMIN_TOKEN` are set
  (`:824`, `:849`).
- A per-router-tenant passport (`src/server.ts:774-797`): `type: 'SERVICE'`,
  `entityId` = the router tenant, `scopes: ['chat']`, `ttlSeconds: 7200` (`:782`),
  cached `6_600_000` ms (`:787`), falling back to the shared token on failure (`:796`).

So the phrase "expired passport" in the user-visible error is **shre-router's wording
about a token that was never a passport at all**.

### 2. Where the 401 actually comes from

Not aros-platform. It is emitted by `requirePassport` in the shreai SDK:

`C:/Users/nirpa/Documents/Projects/shreai/packages/shre-sdk/src/passport-client.ts:157-178`:

```ts
export function requirePassport(client: PassportClient, opts?: { optional?: boolean }) {
  return async (c: HonoLikeContext, next: () => Promise<void>) => {
    const authHeader = c.req.header('authorization') ?? c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      if (opts?.optional) return next();
      return c.json({ error: 'Unauthorized — passport required', code: 'NO_TOKEN' }, 401);   // :163
    }
    const token = authHeader.slice(7);
    const payload = await client.verify(token);
    if (!payload) {
      if (opts?.optional) return next();
      return c.json({ error: 'Invalid or expired passport', code: 'INVALID_TOKEN' }, 401);  // :171
    }
```

Mounted as **middleware** — this matters for idempotency, see §5:

`C:/Users/nirpa/Documents/Projects/shreai/shre-router/src/index.ts:1647-1657`:

```ts
if (AUTH_OPTIONAL || _legacyRequireAuthFalse) {
  app.use('/v1/chat', requirePassportMiddleware(_passportClient, { optional: true }));   // :1648
  …
} else {
  app.use('/v1/chat', requirePassportMiddleware(_passportClient, { optional: false }));  // :1653
  …
  log.info('[auth] Passport auth ENFORCED on /v1/chat + inference routes');              // :1657
}
```

aros-platform streams the router's status and body straight through untouched
(`src/server.ts:1024-1033`), which is why raw upstream JSON reaches the browser.

**Live confirmation (read-only probe, garbage bearer, no model call, run at authoring
time):**

```
$ curl -s -w "\nHTTP:%{http_code}\n" -X POST https://app.aros.live/v1/chat \
    -H "Content-Type: application/json" -H "x-channel: aros" \
    -H "Authorization: Bearer not-a-passport-readonly-probe" \
    -d '{"agentId":"aros-agent","messages":[{"role":"user","content":"probe"}],"stream":false}'
{"error":"Invalid or expired passport","code":"INVALID_TOKEN"}
HTTP:401
```

### 3. The mechanism — a missing `else` in the proxy

`src/server.ts:971-1004`, verbatim (comment included, because the comment already
documents the exact bug and then leaves half of it in place):

```ts
  // Authenticate proxied router traffic. The router speaks PASSPORT JWTs
  // only — but signed-in browsers send their Supabase access token, and
  // forwarding that verbatim made every authed user's chat 401 while
  // anonymous demo chat (which got the service passport) worked. Terminate
  // user auth HERE: verify the Supabase token, swap in the service passport,
  // and carry the resolved tenant on x-tenant-id for cost attribution. An
  // Authorization header that is NOT a valid platform session is forwarded
  // untouched (a caller holding a real passport keeps it; garbage fails
  // closed at the router).
  if (upstreamPath.startsWith('/v1/') && routerPassportToken) {          // :980
    if (!headers.has('authorization')) {
      headers.set('Authorization', `Bearer ${routerPassportToken}`);     // :982  anon path — works
    } else {
      const auth = await authenticateRequest(req);                       // :984
      if (auth) {
        if (process.env.WALLET_ENFORCE === '1' && upstreamPath.startsWith('/v1/chat') && await isWorkspaceFrozen(auth.tenantId)) {
          res.writeHead(402, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'Your workspace is out of credit. Add funds to keep using AI.', code: 'WALLET_FROZEN' }));  // :991
          return;
        }
        const routerTenant = await routerTenantFor(auth.tenantId);       // :999
        headers.set('Authorization', `Bearer ${await passportForTenant(routerTenant)}`);  // :1000
        if (!headers.has('x-tenant-id')) headers.set('x-tenant-id', routerTenant);
      }
      // ← THERE IS NO `else`. auth === null falls straight through.      (:1002-1003)
    }
  }
```

When `auth === null`, the browser's Supabase JWT is forwarded to shre-router verbatim,
where `requirePassport` rejects it. **No log line is emitted on this branch.**

### 4. `authenticateRequest` collapses at least five distinct causes into `null`

`src/server.ts:2557-2605`:

- `:2558-2561` — OIDC cookie session exists but `getRequestedTenantId(req) !== oidcSession.workspaceId` → `null`.
- `:2569-2570` — no `Bearer ` header → `null`.
- `:2575-2576` — `supabase.auth.getUser(token)` errored or returned no user → `null`. **This is genuine expiry.**
- `:2578-2595` — no active `tenant_members` row (after 2 attempts with a 250 ms sleep at `:2592`) → `null`. Includes the case where `getRequestedTenantId` names a tenant the user is not a member of (`:2586` adds `.eq('tenant_id', requestedTenantId)`).
- `:2602-2604` — `catch { return null }`: **any** thrown exception. Supabase outage, network blip, rate limit, admin-client misconfiguration.

`getRequestedTenantId` (`src/server.ts:2550-2555`) reads `x-aros-tenant-id`, then
`x-tenant-id`, then the `?tenantId` query param. ConciergeChat sends `x-tenant-id`,
`x-aros-tenant-id` **and** `X-Workspace-ID` on every turn (`ConciergeChat.tsx:109`).

**Consequence you must state in the PR description:** expiry is only one of five causes.
A client-side refresh repairs the expiry subset only. Because there is zero logging on
the `auth === null` branch, **it is not currently knowable which subset the founder's
6-of-12 hit** — that is why the server-side log in step 1 below is a prerequisite, not a
nice-to-have.

`AuthContext` (the server-side type, unrelated to the React one) is
`src/server.ts:2534-2542`: `{ userId, tenantId, role, bundle }`.
`authenticateRequest(` appears **60 times** in `src/server.ts` (`grep -c`), so its
signature must not change — see step 1.

### 5. The idempotency guarantee — already provable, and a mechanism already exists

**Structural proof that a replay after a 401 cannot double-fire:**

- shre-router: `requirePassport` is registered with `app.use('/v1/chat', …)` at
  `shre-router/src/index.ts:1653`. The handler that does the work is
  `app.post('/v1/chat', async (c) => {` at `shre-router/src/chat-proxy.ts:834`.
  Hono runs `use` middleware before the matching route handler. A 401 `INVALID_TOKEN`
  therefore happens **before** any model call, tool loop, cost record, or
  `markIdempotencySeen` (`chat-proxy.ts:1116`).
- aros-platform: the local interceptors that *can* write run **earlier still** and fail
  soft. `src/server.ts:6783-6792`:

  ```ts
  if (pathname === '/v1/chat' && method === 'POST') {
    const body = await parseJsonBody(req);
    if (await handleArosHealthPing(req, res, body)) return;
    if (await handleArosAutomationChat(req, res, body)) return;
    if (await handleArosStoreDataChat(req, res, body)) return;
    if (await handleArosSalesChat(req, res, body)) return;
    return proxyRequest(req, res, SHRE_ROUTER_URL, body);
  }
  ```

  The only writing interceptor, `handleArosAutomationChat` (`:4632`), calls
  `authenticateRequest` itself at `:4648` and on failure returns a **friendly HTTP 200**
  (`:4651-4652`: `"I couldn't verify your sign-in for this workspace, so I can't manage
  automations right now."`) — it never emits this 401. So **a 401 on `/v1/chat` proves no
  aros-side write happened either.**

**Belt and braces — reuse the router's existing idempotency key. Do NOT build a second
one.** `shre-router/src/chat-proxy.ts:1074-1118`:

```ts
const rawRequestId =
  (typeof body.requestId === 'string' && body.requestId.trim()) ||
  c.req.header('x-idempotency-key') ||
  '';
const requestId = rawRequestId.slice(0, 200);                                   // :1078
const idemScope = requestId ? buildIdempotencyScope(tenantId, sessionId, agentId, requestId) : null;
if (idemScope && isIdempotencyRecentlySeen(idemScope)) {
  return c.json({ error: 'Duplicate requestId already processed recently', requestId }, 409);  // :1094
}
if (idemScope) {
  … if (isRequestInFlight(reqHash)) {
    return c.json({ error: 'Duplicate request already in progress' }, 429);      // :1113
  }
  recordInFlightRequest(reqHash);
  markIdempotencySeen(idemScope);                                                // :1116
}
```

- TTL: `const IDEMPOTENCY_TTL_MS = 60_000;` — `chat-proxy.ts:298`.
- Backing store: `const _recentIdempotency = new Map<string, number>();` —
  `chat-proxy.ts:299`; `_inFlightRequests` at `:295`. **These are in-process Maps.
  The guarantee is single-instance only.** State this as a named limit; do not describe
  it as distributed.
- The router accepts an unknown `requestId` in the body: `chatSchema` ends in
  `.passthrough()` — `shre-router/src/schemas.ts:73` (declaration) and `:130` (the
  `.passthrough()` call). No 400.
- The `x-idempotency-key` header survives the aros proxy: `src/server.ts:954-958` copies
  **every** request header except `host`.

### 6. A third 401 shape exists — the client must key on `code`, not on status

`shre-router/src/token-validation-middleware.ts:162-175` (the global auth gate,
distinct from `requirePassport`):

```ts
log.warn('[auth-gate] Unauthenticated request rejected', { path: c.req.path, … });   // :162
return c.json({
  error: 'Unauthorized — authentication required',
  code: 'NO_TOKEN',                                                                   // :170
  hint: 'Provide a valid Bearer token in the Authorization header. …',
}, 401);
```

And 403 is **not one thing**. A read-only probe of `GET https://app.aros.live/v1/agents`
without credentials returns `{"error":"Forbidden — admin scope required","code":"MISSING_SCOPE"}`
(recorded in the mission recon; treat as **UNVERIFIED-BY-ME** — re-run that single curl
to confirm before relying on the exact wording; the *existence* of a code-bearing 403 is
what the design needs, and that is what matters).

A blanket "on 401/403, refresh and replay" would loop forever on `MISSING_SCOPE` and on
the 402 `WALLET_FROZEN` (`src/server.ts:991`). **Decide on `code`.**

### 7. The client defects, verbatim

`apps/web/src/redesign/ConciergeChat.tsx:86-140` is the whole `send()`. The three
defects:

```ts
  async function send(text: string) {
    const q = text.trim();
    if (!q || sending) return;
    const nextMessages: ChatMsg[] = [...messages, { from: 'me', text: q }];
    setMessages(prev => [...prev, { from: 'me', text: q }]);      // :90  optimistic bubble
    setDraft('');                                                 // :91  DRAFT LOST, before the fetch
    …
      if (!res.ok) throw new Error(`HTTP ${res.status}`);          // :121 body NEVER read
      …
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unknown chat error';
      setMessages(prev => [...prev, { from: 'shre', text: `I couldn’t complete that request (${detail}). Try again in a moment.`, meta: 'Shre · Local' }]);  // :136
    } finally {
      setSending(false);                                          // :138
    }
```

Note `:136` uses a **curly apostrophe** (`’`) — match it if you keep any of that copy.
Note `:121` — the response **body is never read**, so `{error, code:'INVALID_TOKEN'}` is
discarded. Reading it is the precondition for every recovery decision in this track.

The composer that must be restored: `ConciergeChat.tsx:178-188` — a `<form>` whose
`<input value={draft} onChange={e => setDraft(e.target.value)}>` is at `:179-186` and
whose submit calls `send(draft)` at `:178`.

### 8. There is no way to refresh a session anywhere in `apps/web`

- `apps/web/src/contexts/AuthContext.tsx:35-57` — the `AuthContextValue` interface.
  It exposes `refreshOnboarding`, `selectTenant`, `refreshMemberships`, `signIn`,
  `signUp`, `signOut`, `resetPassword`. **There is no `refreshSession`.** The string
  `refreshSession` does not appear anywhere in `apps/web`.
- `apps/web/src/lib/supabase.ts:14-17` — `createClient(url, key)` with **no options**,
  so supabase-js v2 defaults apply: `autoRefreshToken: true`, `persistSession: true`,
  localStorage. Version: `@supabase/supabase-js` `^2.100.0` (`apps/web/package.json`).
  The correct explicit call is **`supabase.auth.refreshSession()`**.
- `AuthContext.tsx:233-239` — `onAuthStateChange` calls `hydrateUserAndSettle(s)` for
  **every** event, including `TOKEN_REFRESHED`. `hydrateUserAndSettle` (`:184-190`) runs
  `hydrateUser` then `setLoading(false)`; membership fetching uses
  `MEMBERSHIP_FETCH_TIMEOUT_MS = 12000` and `MEMBERSHIP_FETCH_ATTEMPTS = 2`
  (`:10-11`). **A naive refresh in the chat path can churn the whole app shell for up to
  24 s.** The recovery path must not await that hydration.
- `AuthContext.tsx:290-304` — `signOut()` ends with `window.location.href = '/login';`
  (`:303`). A navigating re-auth CTA destroys the transcript (see §9).
- **Central-identity mode is a second auth world.** `AuthContext.tsx:212-223`: when
  `centralIdentityOnly` (`lib/supabase.ts:5`, `VITE_AUTH_MODE === 'central'`), the
  provider fetches `GET ${API_BASE}/auth/session` with `credentials: 'include'` (`:214`)
  and fabricates a Session with **`access_token: ''`** (`:219`). In that mode
  ConciergeChat sends **no** `Authorization` header (the `session?.access_token` guard at
  `ConciergeChat.tsx:108` is falsy) and therefore rides the anonymous service-passport
  path at `src/server.ts:982` — it cannot produce this 401, and a Supabase refresh there
  is a no-op. Recovery in that mode must re-hit `GET /auth/session`, not Supabase.

### 9. The transcript exists only in React state

`apps/web/src/redesign/chatHistory.ts:13` — `saveChatConversation(tenantId, id, messages)`
writes the transcript into localStorage under `aros.chat.history.v1:<tenantId>` (`:3`,
`:6`, `:24`), capped at `MAX_CONVERSATIONS = 30` (`:5`).
**It has no callers.** `grep -rn "saveChatConversation" apps/web/src` returns only its own
declaration; `apps/web/src/redesign/data.ts:7` imports only `loadChatHistory` and
`subscribeChatHistory`. So the History tab (`data.ts:509-512`) is permanently empty for
real users, and **any navigation away from chat destroys the conversation**, not just the
draft.

Recall already exists on the other side: `apps/web/src/redesign/AppShell.tsx:130` —
`const recall = (c: Conversation) => { setRecalled(c.messages); … setChatKey(k => k + 1); … }`
and `AppShell.tsx:240` passes `initial={recalled ?? undefined}` into `<ConciergeChat>`.
`ConciergeChat.tsx:54` seeds state from that `initial` prop.

### 10. The other chat surfaces

| File | Mounted? | Sends `Authorization`? | Shares the defects? |
|---|---|---|---|
| `apps/web/src/redesign/ConciergeChat.tsx` | **Yes** — `AppShell.tsx:240` | Yes (`:108`) | **The subject of this track** |
| `apps/web/src/pages/start/StartChat.tsx` | **Yes** — `App.tsx:193` (`import` at `App.tsx:14`) | **No** — headers at `:131` are `{'Content-Type': 'application/json'}` only, despite holding a session (`:62`) | Yes, and worse — see below |
| `apps/web/src/aros-ai/ArosChat.tsx` | **No** — grep across `apps/web/src` finds only comment references (`CanvasContext.tsx:2`, `chatTheme.ts:2`, `composerIcons.tsx:3`). Dead code. | No (`:122`) | Draft loss `:117`, `throw new Error(\`HTTP ${res.status}\`)` `:130`, `'Something went wrong. Please try again.'` `:137` |
| `apps/web/src/components/ChatWidget.tsx` | Yes — `App.tsx:112,120,161,166` (Login/Signup/Contact/Landing) | No | Targets `${CHAT_API}/v1/chat/public` (`:60`) — **unauthenticated by design, out of scope** |

`StartChat.tsx:120-156` is worse than ConciergeChat because its catch **reports success**:

```ts
    setInput('');                                                     // :125  draft lost
    …
      if (!res.ok) throw new Error(`HTTP ${res.status}`);              // :143
      …
      return true;
    } catch {
      setMessages((prev) => [...prev, { role: 'agent', content: reply }]);  // :150 canned string from :127
      return true;                                                    // :151  ← reports SUCCESS
    }
```

and that `true` is consumed by the voice hook at `StartChat.tsx:162`
(`onSend: (text) => { if (sendingRef.current) return false; void sendMessage(text); return true; }`),
so hands-free voice mode keeps talking over a failed turn.

### 11. House patterns you must copy

**Client pure logic** — a framework-free `*Logic.ts` beside the component with a plain
vitest file next to it:

`apps/web/src/redesign/pages/connections/appsLogic.ts:1-13`:

```ts
// Pure list logic for the Active apps page: which apps show, in what order.
// Framework-free so it stays unit-testable.
import type { AppGrant, PlatformApp } from './api';

/** Active (installed) apps only, filtered by search, always A→Z by name. */
export function activeApps(apps: PlatformApp[], grants: AppGrant[], query: string): PlatformApp[] {
```

with `apps/web/src/redesign/pages/connections/appsLogic.test.ts:1-37`
(`import { describe, it, expect } from 'vitest';`, fixtures as tiny factory functions,
plain `expect(...).toEqual(...)`).

**Server pure logic** — `src/wallet.ts` (pure, no I/O, header comment says so) plus
`src/__tests__/wallet.test.ts`. Copy that shape exactly.

**Test registration is an allowlist.** `vitest.config.ts:4-17`:

```ts
    include: [
      'src/**/__tests__/**/*.test.ts',
      'appfactory/**/__tests__/**/*.test.ts',
      'apps/web/src/onboarding/**/*.test.ts',
      // Pure shell logic (framework-free, no DOM/JSX imports). Add ONLY
      // framework-free *.test.ts here — DOM/JSX tests belong to Playwright.
      'apps/web/src/redesign/routes.test.ts',
      'apps/web/src/redesign/pages/connections/appsLogic.test.ts',
      'apps/web/src/redesign/pages/admin/profileLogic.test.ts',
    ],
```

**A new `apps/web` test file will silently not run unless you add it here.** A server-side
test under `src/__tests__/` is picked up automatically by the first glob.

**E2E**: `playwright.config.ts:8-34`. Default (local) mode starts
`pnpm --filter @aros/web dev --port 5599 --strictPort` (`:24`) and specs mock `/api/*` at
the network layer — no backend, no seeded state. Setting `E2E_BASE_URL` walks a deployed
surface instead (`:19`). Run with `pnpm e2e` (root `package.json` → `"e2e": "playwright test"`).
Existing specs: `e2e/connect-my-store.live.spec.ts`, `e2e/install-app-from-marketplace.spec.ts`,
`e2e/journey-seams.spec.ts`, `e2e/manage-my-account.spec.ts`. Copy the route-mocking style
from `e2e/install-app-from-marketplace.spec.ts`.

### 12. UNVERIFIED — things this brief could not confirm, and what would confirm them

| Claim | Why unverified | What would verify it |
|---|---|---|
| Prod `aros-platform` actually has `SHRE_PASSPORT_URL` + `PASSPORT_ADMIN_TOKEN` set | Requires reading `/opt/aros-platform/.env` on aros-vps — operator action, out of scope for a read-only probe | `ssh aros-vps` and read the env; or check that an anonymous `/v1/agents` returns a router RBAC 403 rather than a router auth-gate 401 |
| Which of the five `authenticateRequest` causes produced each of the founder's six 401s | `src/server.ts:983-1003` logs **nothing** on the `auth === null` branch, and the eval harness records only status + reply | The structured log added in Implementation step 1. **This is why step 1 ships first.** |
| Supabase project JWT lifetime for the AROS project (default 3600 s) | Would need the Supabase dashboard | Read the project's Auth settings |
| Whether shre-router runs single-instance in prod (decides whether the 60 s in-memory idempotency window is a real guarantee) | Would need the box's pm2/systemd list | `pm2 list` / `systemctl status` on the router host |
| The exact `MISSING_SCOPE` 403 wording | Recorded in mission recon, not re-probed by me | `curl -s https://app.aros.live/v1/agents` |
| The passport JWT's raw claim names | `shreai/shre-passport/` is an empty directory locally | Check out the submodule, or decode a real passport |

The last row is why the server-side discriminator in step 2 tests for **"is this a
Supabase access token"** rather than **"is this a passport"** — see that step.

---

## Depends on / blocks

**Hard dependencies: none.** This track can start immediately.

**Sequencing inside this track is mandatory:** Implementation step 1 (the server-side
classification + log) must be merged before or with the client retry. Shipping the client
retry alone would burn a refresh and a replay on the four non-expiry causes and still
fail — and, with no log, you would not be able to tell that it had.

**Sibling tracks (briefs live beside this one in `docs/briefs/`):**

| Slug | Relationship | What you must do about it |
|---|---|---|
| **`d-actionable-errors`** | **HARD CONTRACT SHARE.** It defines `ChatAction` / `ChatActionType` in a new `apps/web/src/aros-ai/actions.ts`, adds `actions?: ChatAction[]` to `ChatMsg` at `shellData.ts:55`, and renders the buttons in the bubble. **This track must reuse that field and that file — do NOT add a second, competing `action` field.** See Data contract C5. If `d-actionable-errors` has not landed when you start, you create `actions.ts` with only the four recovery types below and D extends it; if it *has* landed, you extend the existing union. Either way, **one file, one union**. |
| **`a-conversation-persistence`** | Same file, adjacent region. It adds a write path at the single `/v1/chat` seam in `src/server.ts` — the same function region as this track's step 3. Its per-turn record should carry the classified auth-failure `code` from step 1. **Land this track's step 1–3 first** (≈40 lines, self-contained) or expect a manual merge in `proxyRequest`. |
| **`c-honest-data-contract`** | Sibling, low overlap. It adds provenance/`asOf` to answer *content*; this track owns *failure* messaging. Neither should touch the other's copy. Both key on `_shre`, so re-read `ConciergeChat.tsx:127-133` before editing that region. |
| **`e-watchdog-unsilence`** | Downstream consumer. The `[proxy-auth] reason=…` log from step 3 and the typed `code` from C1 are exactly the signal it needs to distinguish "chat is broken" from "the watcher is broken". Do not change the log format after it lands. |
| **`f-real-transcript-eval`** | Downstream of `a-conversation-persistence`, not of this track. No file overlap. |
| **`h-customer-profile-plugin`**, **`i-alerts-register-exceptions`** | No known overlap. |

**Account-lockout constraint (live, mission-wide):** the "Sign in again" CTA navigates to
`/login`. Do **not** attempt a real login as part of building or verifying this track —
repeated failures risk locking `npatel@rapidrms.com` out of production.

**This track blocks:** nothing hard. It unblocks every honest-error track on chat, because
it establishes the wire contract (C1 codes + `recovery` verbs) that error copy keys on.

---

## Data contract

**No database work. No migration, no table, no RLS surface, no golden-record involvement.**
This track is entirely client + proxy + error contract. It must not touch
`canonical_entity`, `entity_alias`, `canonical_strong_key`, `merge_candidate`,
`negative_pair`, `merge_event`, `resolveCanonical()` or `src/golden/store.ts`.

### C1. New proxy error envelope (aros-platform → browser)

Emitted by `src/server.ts` `proxyRequest` when a `/v1/*` request carries a
**Supabase-shaped** bearer that `authenticateRequest` rejected. Content-Type
`application/json`.

```ts
interface ProxyAuthError {
  /** Plain-language, user-showable sentence. Never contains a status code or JSON. */
  error: string;
  /** Stable machine code. The client keys on THIS, never on status alone. */
  code: 'SESSION_EXPIRED' | 'NOT_SIGNED_IN' | 'TENANT_MISMATCH' | 'NOT_A_MEMBER' | 'AUTH_UPSTREAM_UNAVAILABLE';
  /** The one action that moves the user forward. Drives the CTA the client renders. */
  recovery: 'refresh' | 'switch-workspace' | 'request-access' | 'retry';
}
```

Declarative mapping (this table **is** the implementation — put it in code as a
`Record<AuthFailureReason, ProxyAuthErrorSpec>`, not as a chain of `if`s):

| `AuthFailureReason` (internal) | HTTP | `code` | `error` (exact copy) | `recovery` |
|---|---|---|---|---|
| `token-rejected` (`server.ts:2575-2576`) | 401 | `SESSION_EXPIRED` | `Your session expired. Sign in again to pick up where you left off.` | `refresh` |
| `no-credential` (`server.ts:2570`) | 401 | `NOT_SIGNED_IN` | `You're signed out. Sign in to continue.` | `refresh` |
| `tenant-mismatch` (`server.ts:2561`, or `:2586` filtered the row out) | 403 | `TENANT_MISMATCH` | `That request was for a different workspace than the one you're signed in to.` | `switch-workspace` |
| `no-membership` (`server.ts:2595`) | 403 | `NOT_A_MEMBER` | `Your account isn't a member of this workspace yet. Ask an owner to invite you.` | `request-access` |
| `upstream-error` (`server.ts:2602-2604`) | 503 | `AUTH_UPSTREAM_UNAVAILABLE` | `We couldn't check your sign-in just now — that's on us. Try again in a moment.` | `retry` |

The wire `recovery` verb is a **server hint**; the client's own `decideChatRecovery` table
(C4) is authoritative for what button actually renders. Mapping:
`refresh` → refresh-and-replay, then `reauth` if that fails; `switch-workspace` →
`switch_workspace`; `request-access` → no button (the message names the human);
`retry` → `retry_turn`. Do not let the two vocabularies drift into three.

**Distinguish `tenant-mismatch` from `no-membership` cheaply:** if
`getRequestedTenantId(req)` returned a non-null value and the membership query came back
empty, re-run the query **once without** the `.eq('tenant_id', …)` filter. Rows exist →
`tenant-mismatch`. Still empty → `no-membership`. If that second query throws →
`upstream-error`.

### C2. Pre-existing codes the client must also handle (do not change these)

| Source | HTTP | `code` | Meaning |
|---|---|---|---|
| `src/server.ts:991` | 402 | `WALLET_FROZEN` | Out of credit. Never refresh-and-replay. |
| shre-router RBAC | 403 | `MISSING_SCOPE` | Genuinely not permitted. Never refresh-and-replay. |
| `passport-client.ts:171` | 401 | `INVALID_TOKEN` | Legacy shape. Still reachable from an older proxy build or a non-browser caller. Treat as `SESSION_EXPIRED`. |
| `passport-client.ts:163` / `token-validation-middleware.ts:170` | 401 | `NO_TOKEN` | Treat as `NOT_SIGNED_IN`. |
| `chat-proxy.ts:1094` | 409 | *(none — body is `{error, requestId}`)* | Already processed. **Never render a second bubble.** |
| `chat-proxy.ts:1113` | 429 | *(none)* | Same turn already in flight. Wait, do not replay. |

### C3. Client request additions (browser → `/v1/chat`)

Added to the existing send in `ConciergeChat.tsx:104-120`:

- Body gains `requestId: string` — a `crypto.randomUUID()` minted **once per user turn**
  and **reused byte-for-byte on the replay**. Accepted because `chatSchema` is
  `.passthrough()` (`shre-router/src/schemas.ts:130`).
- Header gains `'x-idempotency-key': requestId` — the same value, belt and braces.
  Survives the proxy because `src/server.ts:954-958` copies all headers.

Do **not** invent a new idempotency mechanism. Do **not** change `sessionId` handling;
ConciergeChat sends no `sessionId` today, which degrades the router's scope to
`(tenantId, '', agentId, requestId)` (`chat-proxy.ts:1079-1086`). That is fine for a
random per-turn UUID — but it is exactly why the `requestId` must be random and never
derived from the message text.

### C4. Client pure-logic types

New file `apps/web/src/redesign/chatRecoveryLogic.ts`, framework-free (no React, no DOM,
no imports from anything that touches `window`):

```ts
/** Named budgets. Module-level so a wall of concurrent 401s cannot storm the refresh. */
export const CHAT_AUTH_REPLAY_ATTEMPTS = 1;          // exactly one replay per user turn
export const CHAT_AUTH_REFRESH_TIMEOUT_MS = 4000;    // abort a hung refreshSession()
export const CHAT_AUTH_REFRESH_COOLDOWN_MS = 10000;  // min gap between refresh attempts, app-wide
export const CHAT_AUTH_ADDED_LATENCY_BUDGET_MS = 5000; // total extra wall-clock a recovered turn may cost

export interface ChatFailure {
  status: number;
  /** `code` from the response body, or null when the body was unreadable/absent. */
  code: string | null;
}

export type ChatRecovery =
  | { kind: 'refresh-replay' }
  | { kind: 'duplicate' }                                              // 409 — turn already ran
  | { kind: 'wait' }                                                   // 429 — same turn in flight
  | { kind: 'action'; message: string; actions: ChatAction[] };        // actions may be [] — message alone

/**
 * `ChatAction` / `ChatActionType` are the SHARED type owned by
 * `apps/web/src/aros-ai/actions.ts`. OWNERSHIP RESOLVED 2026-07-24:
 * **track `d-actionable-errors` CREATES that file; this track EXTENDS the union.**
 * Merge order is D -> B(client steps 4-8). Import the type — do not redeclare it
 * here, and do not create the file yourself: if `apps/web/src/aros-ai/actions.ts`
 * does not exist when you reach step 4, D has not landed yet — wait or rebase.
 *
 *   export type ChatActionType =
 *     | 'open_connection_health' | 'open_stores' | 'reconnect_store' | 'connect_store'  // track D
 *     | 'reauth' | 'switch_workspace' | 'retry_turn' | 'open_wallet';                   // this track
 *
 *   export interface ChatAction { type: ChatActionType; resourceId?: string; resourceLabel?: string; }
 *
 * You must ALSO append your four types to D's `CLIENT_ONLY_ACTION_TYPES` array in
 * the same file:
 *
 *   export const CLIENT_ONLY_ACTION_TYPES: ChatActionType[] =
 *     ['reauth', 'switch_workspace', 'retry_turn', 'open_wallet'];
 *
 * That array is what makes D's server-vs-client parity test pass. D's test asserts
 * server ⊆ client (NOT deep-equal — that would fail the moment this track lands),
 * plus "every client type absent from the server union is declared client-only".
 * Skipping the array turns a deliberate superset into an undeclared drift and the
 * test fails — correctly.
 *
 * Track D's rule holds here too: the type carries NO user-visible string. Labels live
 * in `CHAT_ACTION_PRESENTATION` in `actions.ts`:
 *   reauth           → { label: 'Sign in again',    path: null }   // callback — see below
 *   switch_workspace → { label: 'Switch workspace', path: null }   // opens the picker (callback)
 *   retry_turn       → { label: 'Try again',        path: null }   // callback into send()
 *   open_wallet      → { label: 'Add funds',        path: '/wallet' }
 *
 * CORRECTED 2026-07-24 — `reauth` is `path: null`, NOT `path: '/login'`.
 * Verified `apps/web/src/redesign/routes.ts:8-22`: `/wallet` and `/connection-health`
 * ARE keys of `PATH_TO_SECTION`; **`/login` is NOT** — it is a top-level page outside
 * the shell, exactly like `/connect`. D ships the invariant "for every t in
 * CHAT_ACTION_TYPES, actionPath(t) is null or a key of PATH_TO_SECTION" and calls it
 * "the test that makes a dead link impossible to merge". `path: '/login'` would break
 * it, and weakening the invariant to accommodate one row is the wrong trade.
 * `reauth` is a callback anyway: Step 7e already requires it to persist the transcript
 * FIRST and only then navigate to `/login`. So it behaves exactly like
 * `switch_workspace` and `retry_turn` — `path: null`, handled by the `onAction`
 * callback, which does the persist and then `window.location.assign('/login')`.
 *
 * Recovery actions are minted ENTIRELY client-side from an HTTP failure. The server
 * never sends them, so track D's role-gating rule does not apply to these four.
 */

/** Pure. No I/O, no clock, no randomness. `attemptsUsed` = replays already spent this turn. */
export function decideChatRecovery(failure: ChatFailure, attemptsUsed: number): ChatRecovery;

/** Pure. Turns a raw response body into a ChatFailure. Never throws. */
export function parseChatFailure(status: number, bodyText: string): ChatFailure;
```

`decideChatRecovery` rules, as a declarative table:

| Match | Result |
|---|---|
| `status === 409` | `{kind:'duplicate'}` — reachable on **any** same-`requestId` re-issue, including the `refresh-replay` one |
| `status === 429` | `{kind:'wait'}` — rendered as a message + **Try again** CTA. **Never auto-retried**; see Step 6.6 for the verified router mechanism |
| `status === 402 && code === 'WALLET_FROZEN'` | `action` — `Your workspace is out of credit. Add funds to keep using AI.` / **Add funds** |
| `status === 403 && code === 'MISSING_SCOPE'` | `action` — `You don't have permission for that in this workspace. An owner or admin can grant it.` / no button |
| `status === 403 && code === 'TENANT_MISMATCH'` | `action` — the C1 copy / **Switch workspace** |
| `status === 403 && code === 'NOT_A_MEMBER'` | `action` — the C1 copy / no button |
| `status === 503 && code === 'AUTH_UPSTREAM_UNAVAILABLE'` | `action` — the C1 copy / **Try again** |
| `status === 401 && code ∈ {SESSION_EXPIRED, NOT_SIGNED_IN, INVALID_TOKEN, NO_TOKEN, null} && attemptsUsed < CHAT_AUTH_REPLAY_ATTEMPTS` | `{kind:'refresh-replay'}` |
| same but `attemptsUsed >= CHAT_AUTH_REPLAY_ATTEMPTS` | `action` — `Your session expired. Sign in again to pick up where you left off.` / **Sign in again** |
| `status >= 500` | `action` — `Something on our side didn't answer. Your message is back in the box — press Send to try again.` / **Try again** |
| anything else | `action` — `I couldn't complete that request. Your message is back in the box — press Send to try again.` / **Try again** |

Reading the right-hand column: the bold name is the `ChatAction` this row produces
(**Add funds** = `[{type:'open_wallet'}]`, **Switch workspace** = `[{type:'switch_workspace'}]`,
**Try again** = `[{type:'retry_turn'}]`, **Sign in again** = `[{type:'reauth'}]`).
"no button" means `actions: []` — an honest message with no CTA. Per
`get-unstuck.md:27` ("Dead ends are defects") the two `actions: []` rows are permitted
**only** because their message names the human who can unblock the user ("an owner or
admin"), which is the escalation hatch at `get-unstuck.md:28`. Do not add more
buttonless rows.

**Invariant enforced by unit test: no returned `message` may match `/\bHTTP\s*\d{3}\b/`
or contain a `{` character.**

### C5. `ChatMsg` extension (client props)

`apps/web/src/redesign/shellData.ts:55` today:

```ts
export interface ChatMsg { from: 'shre' | 'me'; text: string; meta?: string; agent?: string; tools?: string[]; }
```

Add **one** optional field — and it must be **exactly the field track
`d-actionable-errors` specifies**, because both tracks render CTA buttons in the same
bubble and a second competing field would be a permanent fork:

```ts
import type { ChatAction } from '../aros-ai/actions';

export interface ChatMsg { from: 'shre' | 'me'; text: string; meta?: string; agent?: string; tools?: string[]; actions?: ChatAction[]; }
```

`actions` is optional, so existing `aros.chat.history.v1` localStorage rows still parse —
**no storage key version bump.** (This is also the same extension point the unmerged
rich-input branch uses for its `catalog?: CatalogState` CTA card — see Collision warnings.)

**OWNERSHIP RESOLVED 2026-07-24 — this is no longer "whichever lands first".
Track `d-actionable-errors` OWNS and CREATES `apps/web/src/aros-ai/actions.ts`
and the `shellData.ts:55` `actions?: ChatAction[]` field. This track EXTENDS the
union, appends to `CLIENT_ONLY_ACTION_TYPES`, and adds its four rows to
`CHAT_ACTION_PRESENTATION`. Merge order: D → B(client steps 4–8). Neither creates
a parallel type.** (Steps 1–3 of this track are server-side and still land first,
before everything else in the package — different files entirely. See
§Collision warnings → Package file-ownership register.)

### C6. Server-side structured log (aros-platform stdout)

One line, whenever `authenticateRequest` returns null on a `/v1/*` proxied request.
**Never log the token, any part of it, or a PAN.**

```
[proxy-auth] reason=<AuthFailureReason> path=<upstreamPath> code=<wire code> status=<n> bearer=<supabase|other|none> requestedTenant=<uuid|null> userId=<uuid|null>
```

`bearer=` records the shape discriminator's verdict, not the token.

---

## Implementation steps

Base branch: **`origin/main`** (see Collision warnings for why, and for how to shape the
draft-restore code so the unmerged rich-input branch merges as a superset rather than a
conflict).

Work branch: `fix/chat-401-auto-recovery` in a **worktree**, never in the primary
checkout — `C:/Users/nirpa/Documents/Projects/aros` has concurrent sessions on it.

Steps 1–3 are server-side (`aros` repo, `src/`). Steps 4–8 are client-side
(`aros` repo, `apps/web/`). **Steps 1–3 and steps 4–6 can be developed in parallel**
(disjoint files) but **must merge in order: server first.** Steps 7–9 come last.

---

### Step 1 — Add the pure auth-failure classifier + wire table (`src/authFailure.ts`, NEW)

New framework-free module, modelled on `src/wallet.ts` (pure, no I/O, header comment
saying so).

Export:

```ts
export type AuthFailureReason =
  | 'no-credential' | 'token-rejected' | 'tenant-mismatch' | 'no-membership' | 'upstream-error';

export interface AuthFailureWire {
  status: 401 | 403 | 503;
  code: string;
  error: string;
  recovery: 'refresh' | 'switch-workspace' | 'request-access' | 'retry';
}

/** Declarative table — see Data contract C1. */
export const AUTH_FAILURE_WIRE: Record<AuthFailureReason, AuthFailureWire> = { … };

export function authFailureWire(reason: AuthFailureReason): AuthFailureWire;

/**
 * Is this bearer a Supabase access token (i.e. OUR browser's), as opposed to a
 * passport or another service credential?
 *
 * Decodes the JWT payload WITHOUT verifying it. This is a ROUTING decision only —
 * never derive authorization from these claims. Returns false for anything that
 * is not a well-formed 3-segment JWT with a JSON payload.
 */
export function isSupabaseAccessToken(bearer: string): boolean;
```

`isSupabaseAccessToken` must be conservative: base64url-decode segment 1, `JSON.parse`
inside a `try`, and return `true` only when **either** `typeof iss === 'string' &&
iss.endsWith('/auth/v1')` **or** `payload.role === 'authenticated'`. Anything else →
`false`.

**Why this discriminator and not "is it a passport":** the passport JWT's raw claim names
could not be verified (`shreai/shre-passport/` is an empty directory locally — see
Verified ground truth §12). Testing for "is this ours" instead means the behaviour change
in step 2 applies **only** to browser Supabase tokens — exactly the defect population —
and every existing service-to-service caller that holds a real passport keeps today's
passthrough, preserving the contract documented at `src/server.ts:977-979`.

Reviewer check: the file imports nothing, contains no `fetch`/`fs`/`process`, and every
export is a pure function or a frozen constant.

---

### Step 2 — Give `authenticateRequest` a reason, without changing its signature (`src/server.ts`)

`authenticateRequest(` appears **60 times** in this file. Do **not** change its signature.

Rename the existing body to `authenticateRequestDetailed(req): Promise<{ auth: AuthContext } | { auth: null; reason: AuthFailureReason }>` and return the reason at each of the
five exits identified in Verified ground truth §4:

- `:2561` → `'tenant-mismatch'`
- `:2570` → `'no-credential'`
- `:2576` → `'token-rejected'`
- `:2595` → `'no-membership'` **or** `'tenant-mismatch'` per the disambiguating re-query
  in Data contract C1
- `:2603` (the `catch`) → `'upstream-error'`

Then keep the old name as a one-line wrapper so all 60 call sites are untouched:

```ts
async function authenticateRequest(req: IncomingMessage): Promise<AuthContext | null> {
  return (await authenticateRequestDetailed(req)).auth;
}
```

Reviewer check: `git diff` shows exactly one call site of `authenticateRequestDetailed`
outside its own definition (the one added in step 3), and the count of
`authenticateRequest(` is unchanged at 60 + 1.

---

### Step 3 — Fail closed at the proxy, and log it (`src/server.ts:980-1004`)

Replace the missing `else`. Inside `proxyRequest`, the `else` branch becomes:

```ts
} else {
  const outcome = await authenticateRequestDetailed(req);
  if (outcome.auth) {
    …existing wallet gate (:989-993) and passport swap (:999-1001), unchanged…
  } else {
    const bearerRaw = String(req.headers.authorization || '').slice(7);
    const isOurs = isSupabaseAccessToken(bearerRaw);
    const wire = authFailureWire(outcome.reason);
    console.warn(`[proxy-auth] reason=${outcome.reason} path=${upstreamPath} code=${wire.code} status=${isOurs ? wire.status : 0} bearer=${bearerRaw ? (isOurs ? 'supabase' : 'other') : 'none'} requestedTenant=${getRequestedTenantId(req) ?? 'null'}`);
    if (isOurs) {
      // Never forward a credential we have already determined the router rejects.
      res.writeHead(wire.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: wire.error, code: wire.code, recovery: wire.recovery }));
      return;
    }
    // Not our token — preserve the documented passthrough for service callers
    // holding a real passport (see the comment at :971-979).
  }
}
```

**Behaviour change, stated precisely:** for a browser Supabase bearer that fails
`authenticateRequest`, aros-platform now returns its own typed error instead of
forwarding to shre-router. For every other bearer, behaviour is byte-identical to today.

**Log the reason even in the passthrough case** — that is the line whose absence made the
2026-07-23 incident unfalsifiable.

Reviewer check: the log line exists on **both** paths; the early `return` exists only
under `isOurs`; `bearerRaw` is never logged, only classified.

---

### Step 4 — The client decision core (`apps/web/src/redesign/chatRecoveryLogic.ts`, NEW)

Implement exactly the types and table in Data contract C4. Framework-free: no React
import, no `window`, no `fetch`, no `crypto`. It must be importable by Node with no DOM.

Reviewer check: the file's only `import` is `type`-only or absent; every export is pure;
the message-safety invariant is enforced by the test in step 9, not by a comment.

---

### Step 5 — Expose a guarded session refresh (`apps/web/src/contexts/AuthContext.tsx`)

Add to the `AuthContextValue` interface (`:35-57`, after `refreshMemberships` at `:52`):

```ts
  /**
   * Force a token refresh and return the FRESH access token (or null).
   * Module-level in-flight guard + cooldown: N concurrent 401s produce ONE refresh.
   * Does NOT await the onAuthStateChange membership re-hydration (:233-239) —
   * that can take up to MEMBERSHIP_FETCH_TIMEOUT_MS × MEMBERSHIP_FETCH_ATTEMPTS.
   */
  refreshSession: () => Promise<string | null>;
```

Implementation notes, all load-bearing:

- **Module-level** (outside the component, beside `MEMBERSHIP_RETRY_DELAYS_MS` at `:12`):
  `let refreshInFlight: Promise<string | null> | null = null;` and
  `let lastRefreshAt = 0;`. Import the budgets from `chatRecoveryLogic.ts` — do not
  re-declare the numbers.
- If `Date.now() - lastRefreshAt < CHAT_AUTH_REFRESH_COOLDOWN_MS` and no refresh is in
  flight, return `null` immediately. This is the storm guard: ConciergeChat, the
  `/api/resources/agent` fetch (`ConciergeChat.tsx:69-77`) and the
  `/api/settings/models` fetch (`:78-84`) all carry the same expired token.
- If a refresh is already in flight, **await the same promise** — never start a second.
- Central-identity mode (`centralIdentityOnly`, `AuthContext.tsx:213`): a Supabase
  refresh is meaningless because `access_token` is `''` (`:219`). In that mode,
  `refreshSession` must re-hit `GET ${API_BASE}/auth/session` with
  `credentials: 'include'` (same call as `:214`), update state, and return `''`
  (the empty-string token that mode legitimately uses).
- Otherwise: `await supabase.auth.refreshSession()`, raced against a
  `CHAT_AUTH_REFRESH_TIMEOUT_MS` timeout. On success **return
  `data.session.access_token` directly**. Do not rely on the React `session` state
  having updated — see the stale-closure warning in step 6.
- Add `refreshSession` to the provider's value object (`:312-330`).

Reviewer check: `grep -n "refreshInFlight\|lastRefreshAt" AuthContext.tsx` shows them
declared at module scope, not inside `AuthProvider`.

---

### Step 6 — Rebuild `send()` in `ConciergeChat.tsx` (`apps/web/src/redesign/ConciergeChat.tsx:86-140`)

This is the core change. Rewrite `send()` as: pure decisions from step 4, I/O here.

1. **Mint the turn id once**, before the first attempt:
   `const requestId = crypto.randomUUID();`
2. **Draft safety.** Keep the optimistic bubble at `:90` and the `setDraft('')` at `:91`
   (the responsive feel is deliberate), but add a `restoreDraft` closure immediately
   after — **use this exact shape**, because the unmerged rich-input branch already ships
   a function of the same name at its line 111 and matching it makes the eventual merge a
   near-duplicate rather than a semantic conflict:

   ```ts
   const userMsg: ChatMsg = { from: 'me', text: q };
   const nextMessages: ChatMsg[] = [...messages, userMsg];
   setMessages(prev => [...prev, userMsg]);
   setDraft('');
   const restoreDraft = () => {
     setMessages(prev => prev.filter(m => m !== userMsg));   // drop the orphan bubble
     setDraft(current => current || q);                      // never clobber newer typing
   };
   ```

3. **Extract the attempt into a local `attempt(token: string | undefined)`** that performs
   the fetch from `:104-120` unchanged **except**: the body gains `requestId`, the headers
   gain `'x-idempotency-key': requestId`, and `Authorization` uses the **`token` argument**,
   not `session?.access_token`.

   > **Stale-closure hazard — do not skip this.** `send()` captures `session` from the
   > render that created it. After a successful refresh, the captured `session` still holds
   > the dead token. Passing the token as an argument, sourced from the refresh's return
   > value, is the whole reason step 5 returns the token rather than `void`.

4. **Read the body on failure.** Replace `:121`:

   ```ts
   if (!res.ok) {
     const bodyText = await res.text().catch(() => '');
     return { ok: false as const, failure: parseChatFailure(res.status, bodyText) };
   }
   ```

5. **Drive the decision:**

   ```ts
   let attemptsUsed = 0;
   let result = await attempt(session?.access_token);
   if (!result.ok) {
     const decision = decideChatRecovery(result.failure, attemptsUsed);
     if (decision.kind === 'refresh-replay') {
       const fresh = await refreshSession();
       attemptsUsed += 1;
       if (fresh !== null) result = await attempt(fresh);   // SAME requestId
     }
   }
   ```

   Then re-decide on the (possibly new) failure with the incremented `attemptsUsed` and
   render per its `kind`.

6. **Render each `kind`:**
   - `refresh-replay` succeeded → the normal success path at `:122-133`, untouched.
   - `duplicate` (409) → `restoreDraft()` is **not** called and **no bubble is appended**.
     The first attempt reached the handler and produced an answer that this client never
     saw. Append one honest line instead: `That answer already went through — reload to
     see it.` with a **Try again** action. Never append a second copy of the turn.
   - `wait` (429) → **do NOT auto-retry.** `restoreDraft()`, then append
     `{ from: 'shre', text: 'That question is still being answered. Give it a moment, or press Try again.', meta: 'AROS', actions: [{ type: 'retry_turn' }] }`.
     `retry_turn` re-sends with a **fresh** `requestId` (7d), which is the only re-issue
     shape that can actually get through.

     > **Why the blind 1 s same-id retry was removed (verified against
     > `shreai origin/main:shre-router/src/chat-proxy.ts:1132-1163`).** Read the real
     > order in that file before changing this:
     > 1. `isIdempotencyRecentlySeen(idemScope)` → **409**, `IDEMPOTENCY_TTL_MS = 60_000` (`:299`).
     > 2. `isRequestInFlight(reqHash)` → **429**. `reqHash` is a hash of
     >    *messages + model + agentId + sessionId + tenantId* (`requestHash`) — **not** the
     >    `requestId`.
     > 3. only then `recordInFlightRequest(reqHash)` **and** `markIdempotencySeen(idemScope)` (`:1160-1161`).
     >
     > Two consequences the old step got wrong in opposite directions:
     > - Receiving a 429 means a **different** `requestId` carrying byte-identical content
     >   is already in flight. Your own scope was **not** marked seen — step 3 is after the
     >   429 return — so the retry does not deterministically 409.
     > - It does deterministically fail *again* while the competing request is still
     >   running, and an AROS chat turn runs for seconds, so a 1 s retry is near-certain to
     >   burn the attempt for nothing. And if the competing request *has* finished, the
     >   retry now produces a **second real answer to the same question** — the exact
     >   double-side-effect the idempotency key exists to prevent, unpreventable here
     >   because the competing request used a different key.
     >
     > A 409 remains reachable on any same-`requestId` re-issue that follows a first
     > attempt which got *past* the in-flight check (200, or a downstream failure) —
     > that is the `refresh-replay` path, and `duplicate` already handles it. Therefore
     > **`decideChatRecovery` may return `duplicate` for any re-issue**, and the 429 branch
     > must not assume a clean outcome. That is the second reason this branch now ends in a
     > CTA instead of an automatic retry: a `wait` that silently becomes a `duplicate` has
     > no honest rendering.
   - `action` → `restoreDraft()`, then append
     `{ from: 'shre', text: decision.message, meta: 'AROS', actions: decision.actions }`.
7. **`finally { setSending(false); }`** stays as it is at `:137-139`.
8. **Delete the old catch copy at `:136`.** The only remaining `catch` is for genuine
   transport errors (network down, JSON parse) and must route through
   `decideChatRecovery({ status: 0, code: null }, attemptsUsed)` so it too gets a named
   message and a CTA — never a bare `error.message`.

**Performance budget:** a recovered turn must add no more than
`CHAT_AUTH_ADDED_LATENCY_BUDGET_MS` (5000 ms) of wall clock on top of the normal turn:
≤ 4000 ms refresh + one replay. The typing indicator at `:164-169` stays visible for the
whole window — no frozen screen (`docs/journeys/ask-a-question-get-a-real-answer.md:20`).

---

### Step 7 — Render the CTA, and make "Sign in again" non-destructive

**7a. `apps/web/src/aros-ai/actions.ts`** — the shared action module (owned jointly with
track `d-actionable-errors`). If it does not exist yet, create it with `ChatActionType`,
`ChatAction`, and `CHAT_ACTION_PRESENTATION` carrying **only** this track's four rows
(`reauth`, `switch_workspace`, `retry_turn`, `open_wallet`) per Data contract C4. If it
already exists, **extend** the union and the presentation record — never duplicate them.

**7b. `apps/web/src/redesign/shellData.ts:55`** — add `actions?: ChatAction[]` per Data
contract C5.

**7c. `ConciergeChat.tsx:148-163`** (the message map) — when `m.actions?.length`, render
one real `<button type="button">` per action inside the bubble, below the text, with its
accessible name equal to `CHAT_ACTION_PRESENTATION[a.type].label`, so the E2E in step 9
can find it by role. Unknown action types must be **dropped, never rendered** (same
validate-on-receipt rule track D applies to server-sent actions).

**7d. Wire the four actions:**

| `type` | Behaviour |
|---|---|
| `retry_turn` | Re-send the same text through `send()` with a **new** `requestId` (a genuinely new turn, not a replay). |
| `open_wallet` | Navigate to the wallet section via a new prop on `<ConciergeChat>`, wired in `AppShell.tsx:240` the same way `onConnectApps` (`ConciergeChat.tsx:47`) is wired to `goSection('apps')`. Do not hard-code a URL inside the component. |
| `switch_workspace` | Open the existing workspace picker. Do **not** sign out. |
| `reauth` | **Persist first, then navigate.** See 7e. This is why its `CHAT_ACTION_PRESENTATION` row is `path: null` — it is a callback with a side effect, not a plain link (Stop conditions #2). |

**7e. Non-destructive re-auth.** `signOut()` ends with `window.location.href = '/login'`
(`AuthContext.tsx:303`) and the transcript lives only in React state
(`saveChatConversation` has **no callers** — Verified ground truth §9). Navigating today
would destroy the whole conversation, which breaks `get-unstuck.md:26` ("Resumable")
harder than the bug being fixed.

Before navigating, the `reauth` handler must:

1. Call `saveChatConversation(tenant?.id, conversationId, messages)` from
   `apps/web/src/redesign/chatHistory.ts:13` — reviving the existing function; do not
   write a new persistence layer.
2. `sessionStorage.setItem('aros.chat.resumeId', conversationId)`.
3. Then navigate to `/login`.

And on mount, `AppShell` must consume that key: if `aros.chat.resumeId` is present, look
it up via `loadChatHistory(tenant?.id)` (`chatHistory.ts:8`) and call the **existing**
`recall(...)` at `AppShell.tsx:130`, then remove the key. `recall` already does
`setRecalled(c.messages)` and bumps `chatKey`, and `AppShell.tsx:240` already passes
`initial={recalled ?? undefined}` into `<ConciergeChat>`. No new plumbing.

Reviewer check: after a `reauth` CTA + sign-in, the pre-failure transcript is on screen.

---

### Step 8 — Fix the co-defect surface: `StartChat.tsx`

`apps/web/src/pages/start/StartChat.tsx:120-156`. Two changes, both minimal:

1. **Draft preservation + honest failure.** Mirror step 6's `restoreDraft` shape. Replace
   the canned `reply` at `:127` / `:150` with `decideChatRecovery(...)`'s message from the
   shared pure module. Reuse `chatRecoveryLogic.ts` — do not fork the table.
2. **Stop lying to the voice hook.** `:151` returns `true` from the catch, so hands-free
   voice keeps talking over a failed turn (consumed at `:162`). Return `false` on failure.

**Do not** add an `Authorization` header to `StartChat`'s chat call at `:131`. It runs on
the anonymous service-passport path today, and changing that changes cost attribution and
tenant scoping — a separate track. Add a one-line code comment saying so, so the omission
reads as deliberate.

---

### Step 9 — Tests, journey specs, and test registration

See Acceptance tests for the exact commands. Included here so the step is reviewable:

- New `apps/web/src/redesign/chatRecoveryLogic.test.ts`.
- New `src/__tests__/auth-failure.test.ts`.
- **Register the client test in `vitest.config.ts`** — add
  `'apps/web/src/redesign/chatRecoveryLogic.test.ts'` to the `include` array at
  `vitest.config.ts:5-15`. Without this line the test silently never runs. (The server
  test needs no registration — `'src/**/__tests__/**/*.test.ts'` at `:6` already covers it.)
- New `e2e/chat-session-recovery.spec.ts`.
- Journey spec updates: `docs/journeys/get-unstuck.md` and
  `docs/journeys/ask-a-question-get-a-real-answer.md` — see Acceptance tests §5.
  The journey gate in `CLAUDE.md` requires the spec update **and** a golden-path E2E for
  any journey-altering PR. This PR alters both journeys' failure rows.

---

## Acceptance tests

### 1. Client pure-logic unit tests — `apps/web/src/redesign/chatRecoveryLogic.test.ts`

```
pnpm exec vitest run apps/web/src/redesign/chatRecoveryLogic.test.ts
```

(After adding the path to `vitest.config.ts:5-15`, `pnpm exec vitest run` picks it up too.)

Fixtures and required cases — copy the shape of
`apps/web/src/redesign/pages/connections/appsLogic.test.ts:1-37`:

```ts
import { describe, it, expect } from 'vitest';
import { decideChatRecovery, parseChatFailure, CHAT_AUTH_REPLAY_ATTEMPTS } from './chatRecoveryLogic';

const f = (status: number, code: string | null = null) => ({ status, code });

describe('decideChatRecovery', () => {
  it('refreshes and replays exactly once on an expired session', () => {
    expect(decideChatRecovery(f(401, 'SESSION_EXPIRED'), 0)).toEqual({ kind: 'refresh-replay' });
    expect(decideChatRecovery(f(401, 'INVALID_TOKEN'), 0)).toEqual({ kind: 'refresh-replay' });
    expect(decideChatRecovery(f(401, 'NO_TOKEN'), 0)).toEqual({ kind: 'refresh-replay' });
    expect(decideChatRecovery(f(401, null), 0)).toEqual({ kind: 'refresh-replay' });
  });

  it('stops replaying at the budget and offers re-authentication', () => {
    const d = decideChatRecovery(f(401, 'SESSION_EXPIRED'), CHAT_AUTH_REPLAY_ATTEMPTS);
    expect(d.kind).toBe('action');
    expect(d.kind === 'action' && d.actions.map(a => a.type)).toEqual(['reauth']);
  });

  it('NEVER refresh-replays a permission or wallet failure', () => {
    for (const failure of [f(403, 'MISSING_SCOPE'), f(402, 'WALLET_FROZEN'), f(403, 'NOT_A_MEMBER')]) {
      expect(decideChatRecovery(failure, 0).kind).not.toBe('refresh-replay');
    }
    expect(decideChatRecovery(f(402, 'WALLET_FROZEN'), 0)).toMatchObject({ actions: [{ type: 'open_wallet' }] });
    expect(decideChatRecovery(f(403, 'TENANT_MISMATCH'), 0)).toMatchObject({ actions: [{ type: 'switch_workspace' }] });
    // Buttonless-but-honest rows still carry a named human who can unblock.
    expect(decideChatRecovery(f(403, 'MISSING_SCOPE'), 0)).toMatchObject({ actions: [] });
  });

  it('treats 409 as already-processed and 429 as in-flight', () => {
    expect(decideChatRecovery(f(409), 0)).toEqual({ kind: 'duplicate' });
    expect(decideChatRecovery(f(429), 0)).toEqual({ kind: 'wait' });
  });

  it('never leaks a status code or JSON into user-visible copy', () => {
    const cases = [f(401,'SESSION_EXPIRED'), f(403,'MISSING_SCOPE'), f(500), f(0), f(418,'TEAPOT')];
    for (const c of cases) for (const used of [0, 1, 2]) {
      const d = decideChatRecovery(c, used);
      if (d.kind !== 'action') continue;
      expect(d.message).not.toMatch(/\bHTTP\s*\d{3}\b/);
      expect(d.message).not.toContain('{');
      expect(d.message.length).toBeGreaterThan(20);
    }
  });
});

describe('parseChatFailure', () => {
  it('extracts the code from a router 401', () => {
    expect(parseChatFailure(401, '{"error":"Invalid or expired passport","code":"INVALID_TOKEN"}'))
      .toEqual({ status: 401, code: 'INVALID_TOKEN' });
  });
  it('survives an empty or non-JSON body', () => {
    expect(parseChatFailure(502, '<html>bad gateway</html>')).toEqual({ status: 502, code: null });
    expect(parseChatFailure(401, '')).toEqual({ status: 401, code: null });
  });
});
```

The first `parseChatFailure` fixture string is the **verbatim live prod body** captured in
Verified ground truth §2.

### 2. Server pure-logic unit tests — `src/__tests__/auth-failure.test.ts`

```
pnpm exec vitest run src/__tests__/auth-failure.test.ts
```

Required cases:

- `authFailureWire('token-rejected')` → `{status:401, code:'SESSION_EXPIRED', recovery:'refresh'}`.
- `authFailureWire('upstream-error')` → `{status:503, code:'AUTH_UPSTREAM_UNAVAILABLE', recovery:'retry'}` — asserting an infrastructure failure is **not** presented as an authentication failure.
- Every `AuthFailureReason` has an entry (iterate the union) and no `error` string contains a digit-triple or a `{`.
- `isSupabaseAccessToken`: `true` for a hand-built unsigned JWT whose payload is
  `{"iss":"https://xyz.supabase.co/auth/v1","role":"authenticated"}`; `false` for
  `'not-a-jwt'`, `''`, `'a.b'`, and a 3-segment JWT whose payload is
  `{"entityId":"aros-platform","type":"SERVICE"}`.

### 3. Existing suites must stay green

```
pnpm exec vitest run          # all registered unit tests (vitest.config.ts include list)
pnpm typecheck                # turbo typecheck, covers apps/web tsc --noEmit
pnpm lint
```

`src/__tests__/auth-conformance.test.ts` and `src/__tests__/auth-client-hygiene.test.ts`
already exist and touch this area — they must not regress. There is also
`pnpm test:auth-conformance` (root `package.json`).

### 4. RLS negative tests

**Not applicable — this track touches no database, no migration, and no table.**
If your implementation finds itself writing SQL, **stop**: that is out of scope and a
signal the design drifted (see Stop conditions).

### 5. Journey specs (gate requirement, not optional)

- `docs/journeys/get-unstuck.md` — add a failure row for the chat auth failure recording
  the two-step budget: *silent refresh + replay (invisible)* → *named message + one-tap
  CTA*. The rules it must satisfy are already written at `:22`, `:24`, `:25`, `:27`.
- `docs/journeys/ask-a-question-get-a-real-answer.md` — extend the failure table (`:14-20`)
  with a "sign-in expired mid-question" row, and make the existing "no double-fire on
  retry" requirement at `:20` explicit about the shared `requestId`.

### 6. Golden-path E2E — `e2e/chat-session-recovery.spec.ts`

```
pnpm e2e -- e2e/chat-session-recovery.spec.ts
```

Local mode (default) starts the web app on port 5599 and mocks at the network layer
(`playwright.config.ts:19-34`); copy the structure of
`e2e/install-app-from-marketplace.spec.ts`.

> **Entry point and session — do not skip this, the spec cannot pass without it.**
> **Go to `/preview/app`, not `/chat`.** Verified on `origin/main` @ `9b4a693`:
> `apps/web/src/app/App.tsx:92-95` returns `<AppShell />` for any path starting
> `/preview/app` **before** any auth check; every other shell path falls through
> `<ProtectedRoute>` (`:224-228`) and then the `!onboarded` redirect (`:235-242`). All four
> existing specs use `/preview/app` for exactly this reason, and
> `e2e/install-app-from-marketplace.spec.ts:7` says so in the file. `/preview/app` mounts
> the same `<ConciergeChat>` (`AppShell.tsx:3, :240`), so this is the real component, not a
> stand-in.
>
> **A mocked `/v1/chat` is not sufficient on its own.** `ConciergeChat.tsx:108` only sets
> `Authorization` when `session?.access_token` is truthy, and in local Playwright mode there
> is no Supabase session — so without the seeding below, `refreshSession()` returns `null`,
> the replay never fires, and test 1's `x-idempotency-key` equality assertion (**the
> no-double-side-effect assertion**) silently never runs. Add to the spec's `beforeEach`:
>
> ```ts
> // 1. Seed a fake Supabase session so AuthContext hydrates with a token.
> //    Key shape: `sb-<project-ref>-auth-token`, where <project-ref> is the host label
> //    of VITE_SUPABASE_URL (playwright.config.ts defaults it to https://e2e-local.supabase.co).
> await page.addInitScript(() => {
>   const now = Math.floor(Date.now() / 1000);
>   localStorage.setItem('sb-e2e-local-auth-token', JSON.stringify({
>     access_token: 'e2e-access-token-1', refresh_token: 'e2e-refresh-token',
>     token_type: 'bearer', expires_in: 3600, expires_at: now + 3600,
>     user: { id: '00000000-0000-4000-8000-000000000001', email: 'e2e@example.test', aud: 'authenticated', role: 'authenticated' },
>   }));
> });
> // 2. Mock the refresh endpoint so refreshSession() returns a DIFFERENT token —
> //    that difference is what proves step 6.3 passes the token as an argument
> //    instead of reading the stale closure.
> await page.route('**/auth/v1/token**', route => route.fulfill({
>   status: 200, contentType: 'application/json',
>   body: JSON.stringify({ access_token: 'e2e-access-token-2', refresh_token: 'e2e-refresh-token-2',
>     token_type: 'bearer', expires_in: 3600, user: { id: '00000000-0000-4000-8000-000000000001' } }),
> }));
> // 3. Mock the tenant/workspace reads the shell makes on mount, so it renders the chat
> //    pane rather than an error state. Match the existing specs' `**/api/**` style.
> ```
>
> **Reviewer check:** assert in test 1 that the *second* intercepted `/v1/chat` request
> carried `Authorization: Bearer e2e-access-token-2`. If it carried `…-1`, the stale-closure
> hazard in step 6.3 is unfixed and the test is passing for the wrong reason.
>
> **If the session seeding cannot be made to work** (e.g. the Supabase client's storage key
> differs in this version): do **not** delete the assertions. Mark the file
> `test.describe.configure({ mode: 'serial' })` + `test.skip(!process.env.E2E_BASE_URL, …)`
> and state plainly in the PR that tests 1 and 2 are **beta-only** (`E2E_BASE_URL` against a
> deployed non-production surface), leaving the pure `chatRecoveryLogic.test.ts` cases
> (Acceptance §1) as the local merge gate. An honestly-skipped test is acceptable; a test
> that passes because its assertion never executed is not.

Three tests, each driving the **real UI** the way a stranger would — from the entry point,
reading only what is on screen:

1. **Silent recovery.** Navigate to `/preview/app` and open the chat pane. `page.route('**/v1/chat', …)`: first call fulfils
   `status: 401, body: '{"error":"Your session expired…","code":"SESSION_EXPIRED"}'`;
   second call fulfils a normal 200 answer. Assert: the answer text is visible; the string
   `HTTP 401` never appears in the DOM; the composer is empty (the turn succeeded); and the
   two intercepted requests carried the **same** `x-idempotency-key` (capture it from
   `route.request().headers()` and assert equality — **this is the no-double-side-effect
   assertion**).
2. **Dead-end-free failure.** Both calls 401. Assert: a bubble contains the words
   `session expired`, a `<button>` named `Sign in again` is visible, the composer contains
   the exact text the user typed, the orphan user bubble is gone, and `HTTP 401` appears
   nowhere.
3. **No refresh on a permission failure.** Single call fulfils
   `status: 403, body: '{"error":"Forbidden — admin scope required","code":"MISSING_SCOPE"}'`.
   Assert: exactly **one** request was made to `/v1/chat` (no replay), the message names
   permission, and there is no `Sign in again` button.

### 7. Live proof (read-only, no login)

The 401 body is reproducible on prod without touching an account:

```
curl -s -w "\nHTTP:%{http_code}\n" -X POST https://app.aros.live/v1/chat \
  -H "Content-Type: application/json" -H "x-channel: aros" \
  -H "Authorization: Bearer not-a-passport-readonly-probe" \
  -d '{"agentId":"aros-agent","messages":[{"role":"user","content":"probe"}],"stream":false}'
```

**Before this track:** `{"error":"Invalid or expired passport","code":"INVALID_TOKEN"}` / 401.
**After deploy, the same probe must return** `{"error":"Your session expired…","code":"SESSION_EXPIRED","recovery":"refresh"}` / 401 — because that garbage bearer is not
Supabase-shaped… **it will NOT.** `isSupabaseAccessToken('not-a-passport-readonly-probe')`
is `false`, so it takes the preserved passthrough and still returns the router's
`INVALID_TOKEN`. **That is the correct outcome and the probe's real value: it proves the
service-caller passthrough was not broken.** To exercise the new envelope, use a
well-formed but expired/garbage Supabase-shaped JWT (three base64url segments whose
payload is `{"iss":"https://<project>.supabase.co/auth/v1","role":"authenticated"}`); it
must return the typed 401 above, and `journalctl`/pm2 logs must show one
`[proxy-auth] reason=token-rejected … bearer=supabase` line.

**Do not attempt a login as part of this verification.** An account-lockout risk is live
on `npatel@rapidrms.com`.

---

## Non-goals

Do not touch, in this track:

1. **Any database work.** No migration, no table, no RLS policy, no Supabase schema change.
2. **The golden-record layer.** `canonical_entity`, `entity_alias`,
   `canonical_strong_key`, `merge_candidate`, `negative_pair`, `merge_event`,
   `resolveCanonical()`, `src/golden/store.ts`. A second identity-resolution path is an
   automatic stop.
3. **The `shreai` repo.** shre-router, shre-passport and `packages/shre-sdk` are **read-only
   references** here. Do not modify `requirePassport`, the idempotency window, or the router's
   error shapes. If the fix seems to require a shreai change, stop and escalate.
4. **Cost attribution / who-pays-for-a-`/start`-turn.** `StartChat.tsx:131` deliberately
   keeps sending no `Authorization`. Fixing that is a separate track.
5. **`apps/web/src/aros-ai/ArosChat.tsx`.** It is unmounted dead code and cannot produce
   this 401 (no `Authorization` header at `:122`). Leave it exactly as it is — it was
   rewritten one commit ago (PR #201, `a07c9dc`) and has live tests around its
   voice/canvas helpers. Do not delete it either; that is a cleanup decision for the founder.
   **CONFIRMED PACKAGE-WIDE 2026-07-24 — this non-goal was right and is now the rule for
   every track.** Re-verified first-hand: declaration at `:41`, five comment-only
   references, no import, no JSX usage, no mount; `App.tsx:255` routes every onboarded
   authenticated path (`/chat` included) to `<AppShell />` and `AppShell.tsx:3,:240`
   mounts **`ConciergeChat`**. Two sibling briefs had it wrong and are now corrected:
   `d-actionable-errors` §S + step 7f (which instructed extending it) and
   `a-conversation-persistence` §9 + step 9 + acceptance E (which treated it as the live
   widget and built the keystone E2E on it). The file is **frozen for the whole package**
   — see §Collision warnings → Package file-ownership register, and
   `d-actionable-errors.md` §Stop conditions #11 for the delete-or-mount founder question.
6. **`apps/web/src/components/ChatWidget.tsx`.** Unauthenticated by design
   (`${CHAT_API}/v1/chat/public`, `:60`). Its draft-loss at `:54` is a real but separate defect.
7. **The "History tab never populates" defect.** Step 7d calls `saveChatConversation`
   on the re-auth path **only**. Making chat history work generally is a separate track;
   do not generalise it here.
8. **`WALLET_ENFORCE` and the freeze gate** (`src/server.ts:989-993`). Read it, classify it,
   render it — never change it.
9. **The chat transport shape.** No streaming, no SSE, no new endpoint. The only body/header
   additions are `requestId` and `x-idempotency-key`.
10. **Adding a second idempotency mechanism.** The router's is at
    `chat-proxy.ts:1074-1118`. Use it.
11. **Restarts, deploys, pushes, PRs.** Not in this track's authority.

---

## Collision warnings

### Package file-ownership register (RESOLVED 2026-07-24 — authoritative, identical in every brief)

**One owning track per contested file. The arrows are a merge order, not a
preference.** This supersedes every "whichever lands first" phrasing elsewhere in
this brief.

| File | OWNER (creates / restructures) | Merge order | Rule for non-owners |
|---|---|---|---|
| `src/server.ts` `proxyRequest` (`:948-1034`) | **THIS TRACK (B)**, steps 1–3 | **B(1–3) → A** | Your ~40 lines land first in the whole package. Track A then hooks a `proxyRequest` that already classifies auth. |
| `src/server.ts` `/v1/chat` dispatch block (`:6783-6792`) | **C** (`c-honest-data-contract`) | **C → D → I → A** | **Not this track.** A different region of the same file — do not conflate the two; that conflation is why "B first" and "A last" both read as contradictions in the first draft. |
| `apps/web/src/aros-ai/actions.ts` (NEW) | **D** (`d-actionable-errors`) | **D → B(client steps 4–8)** | **You extend, D creates.** Append your four types to the union AND to `CLIENT_ONLY_ACTION_TYPES`; add your four `CHAT_ACTION_PRESENTATION` rows with `reauth → path: null` (Stop conditions #2). If the file is absent at step 4, D has not landed — wait or rebase. |
| `apps/web/src/redesign/shellData.ts:55` (`ChatMsg.actions`) | **D** | **D → B** | One optional field, added once, by D. You import the type. |
| `apps/web/src/redesign/ConciergeChat.tsx` | shared — **you** rewrite the failure half of `send()`, **C** reads `_shre` on the success half, **D** adds the `actions` read + `onAction` prop, **A** adds a `conversationIdRef` | **B → C → D → A** | All four edit the same ~40 lines. Land serially; re-read immediately before each edit. |
| `apps/web/src/aros-ai/ArosChat.tsx` | **NOBODY — FROZEN** | — | Your Non-goal 5 is now the package rule. D's step 7f and A's step 9 ArosChat half have both been removed. |
| `scripts/chat-eval/triage.mjs` + `triage-core.mjs` | **E** (structural) | **E → F** | Not this track. |
| `scripts/chat-eval/core.mjs` | **F** steps 3–4 | **F → C(step 10)** | Not this track. |
| `src/chat/redact.ts` + `src/chat/__fixtures__/pan-redaction.json` (NEW) | **D** (`d-actionable-errors` §Data contract 6a) — the package's **one** PAN redactor (`redactPan`, Luhn-gated) plus the shared fixture list | **D → A**; F mirrors | Not this track. If any error/diagnostic text you touch could carry a card number, **import `redactPan`** — never write a digit rule of your own. |
| `public.platform_settings` DDL | `supabase/migrations/20260723_platform_settings.sql:9-15` | — | Not this track (Non-goal 1: no database). |

**Globally satisfiable merge order for `src/server.ts`:**
**B(1–3) → C(step 3) → D → I → A(migration + steps 4–11) → F(6,7,9,10).**
Inside `scripts/chat-eval/`: **E → F(3,4,5) → C(step 10) → F(6,7,9,10)**.
Client-side, this track splits: **steps 1–3 land first in the package; steps 4–8
land after D.** They are disjoint files, so the split costs nothing.

---

### `origin/feat/chat-rich-input-aros` — unmerged, rewrites the same function

Three commits ahead of main (`b0138dc`, `b3fb4ef`, `30f1feb`). It edits
`apps/web/src/redesign/ConciergeChat.tsx` (+124), `src/server.ts` (+151),
`vitest.config.ts` (+6), `apps/web/src/redesign/chatHistory.ts` (+22), and adds
`redesign/attach/*` and `chatIntent.ts`.

It **already implements draft preservation** — its `restoreDraft()` at its line 111:

```ts
    const restoreDraft = () => {
      setMessages(prev => prev.filter(m => m !== userMsg));
      setDraft(current => current || q);
      setPending(current => (current.length ? current : atts));
    };
```

called from its catch at its line 181, with copy in the right register:
`Your message is back in the box — press Send to try again.`

It does **not** touch the 401 path: `if (!res.ok) throw new Error(\`HTTP ${res.status}\`);`
survives at its line 153.

**Sequencing decision (do this):** base on `origin/main` — it is the repo of record and the
rich-input branch may never merge. Write `restoreDraft` with the **identical name, identical
placement (immediately after `setDraft('')`), and identical first two lines**, omitting only
the attachment line. The merge then resolves as a superset. Whoever merges second keeps
both: rich-input's `setPending` line inside `restoreDraft`, and this track's recovery flow
around it. **Say this explicitly in the PR body.**

Both branches also edit `vitest.config.ts`'s `include` array — a trivial but certain
conflict. Expect it; resolve by keeping both new entries.

### Sibling tracks in this same mission — shared files

These briefs live beside this one in `docs/briefs/`. Read the relevant one before you
touch a shared file.

| File | Also edited by | How to sequence |
|---|---|---|
| `apps/web/src/redesign/shellData.ts:55` (`ChatMsg`) | `d-actionable-errors` (adds `actions?: ChatAction[]`) | **One field, not two. RESOLVED: D adds it, this track reuses it.** Data contract C5. |
| `apps/web/src/aros-ai/actions.ts` (NEW) | `d-actionable-errors` **owns and creates it** (`ChatActionType`, `ChatAction`, `CHAT_ACTION_TYPES`, `CLIENT_ONLY_ACTION_TYPES`, `CHAT_ACTION_PRESENTATION`, `buildChatActions`, `actionPath`) | **RESOLVED: D → B.** D creates; **this track extends the union**, appends its four types to `CLIENT_ONLY_ACTION_TYPES`, and adds four presentation rows (`reauth → path: null`). Never a parallel type. |
| `apps/web/src/redesign/ConciergeChat.tsx` message map (`:148-163`) | `d-actionable-errors` (renders server-sent action buttons), `c-honest-data-contract` (renders provenance/`asOf`) | All three render inside the same bubble. Land them serially and re-read the file before each. |
| `apps/web/src/redesign/ConciergeChat.tsx` `send()` (`:86-140`) | `c-honest-data-contract` (reads `_shre` at `:127-133`) | This track rewrites the failure half; C touches the success half. Small overlap, but re-read before editing. |
| `src/server.ts` `proxyRequest` (`:948-1034`) | `a-conversation-persistence` (adds a write path at the `/v1/chat` seam) | **Land this track's steps 1–3 first** — ~40 lines, self-contained. Then A builds on a `proxyRequest` that already classifies auth. |
| `vitest.config.ts` `include` (`:5-15`) | `d-actionable-errors`, `c-honest-data-contract`, `a-conversation-persistence`, and the unmerged rich-input branch all add entries | Certain trivial conflict. Resolve by keeping **every** entry. |
| `docs/journeys/get-unstuck.md` | `d-actionable-errors` (same recovery contract) | Append rows; do not rewrite the contract table at `:19-28`. |

### Recently rewritten files — one commit old

`a07c9dc` (PR #201, `HEAD~1`, "unify AROS composer icons to the Shre Composer contract")
rewrote `ArosChat.tsx`, `ChatWidget.tsx` and `StartChat.tsx`. Step 8 touches `StartChat.tsx`.
Re-read it immediately before editing — do not work from a stale copy or from this brief's
line numbers if the file has moved on.

### Other open branches on `aros`

`origin/feat/composer-icons`, `origin/feat/voice-e2e`, `origin/feat/voice-chat-v2`,
`origin/chat-eval-budgets`. The voice branches touch `useVoice` and its consumers —
which includes `StartChat.tsx:158-163`, the exact hook whose `onSend` contract step 8
changes (`return false` on failure). **Coordinate step 8 with the voice-branch owner
before merging**, or land steps 1–7 first and step 8 as a follow-up PR.

### Concurrent sessions

`C:/Users/nirpa/Documents/Projects/aros` and
`C:/Users/nirpa/Documents/Projects/shreai` are **primary checkouts with live concurrent
sessions**. Never run a branch-switching or tree-mutating git command in either. Read
other refs with `git show <ref>:<path>`. Do all work in a worktree under
`~/.shre/worktrees/aros/<branch-slug>` (helper: shre-dev-kit `scripts/worktree.ps1` /
`scripts/worktree.sh`).

### Within `src/server.ts`

7214 lines and a busy file. Steps 2 and 3 touch two small, distant regions
(`:2557-2605` and `:980-1004`). Keep them in one focused commit so a rebase is cheap.

---

## Rollback

The change is three independent, individually revertible layers. Nothing is persisted,
so **no data migration or backfill exists to undo**.

**Layer 3 — client (fastest, no backend involvement).** Revert the commits touching
`apps/web/`. Chat returns to today's behaviour: 401 → `HTTP 401` bubble, draft lost. The
server's new typed 401 body is then simply rendered as a generic failure — **no crash**,
because the client's failure path never depended on parsing it (verify: the reverted
`ConciergeChat.tsx:121` reads only `res.status`).

**Layer 2 — proxy fail-closed (`src/server.ts` step 3).** The riskiest layer: it changes
what a browser bearer does on `/v1/*`. Two rollback options, in order of preference:

1. **Flag it from the start.** Gate the `if (isOurs) { … return; }` early-return on
   `process.env.PROXY_AUTH_FAIL_CLOSED !== '0'`. Rollback is then an env change plus a
   restart, no redeploy. **Ship it this way** — the same pattern the wallet gate uses
   (`WALLET_ENFORCE === '1'`, `src/server.ts:989`).
2. `git revert` the commit and redeploy.

Either way the log line from step 3 should be kept — it costs nothing and it is the only
production visibility this failure has ever had.

**Layer 1 — `src/authFailure.ts` + the `authenticateRequestDetailed` split.** Inert on its
own: a pure module plus a signature-preserving wrapper. **Do not revert this layer** unless
layers 2 and 3 are both already out; it is the least likely source of a regression and the
most useful thing to keep.

**Blast radius if this ships badly:** worst case, an authenticated user whose Supabase
token fails verification for a transient reason now gets a typed 503 "try again" instead of
a 401 that would have failed anyway. No user loses data — the draft is preserved on every
path by construction, and the transcript is persisted before any navigation. There is no
write path in this track at all.

**Rollback verification:** re-run the read-only prod probe in Acceptance tests §7 and
confirm it returns `{"error":"Invalid or expired passport","code":"INVALID_TOKEN"}` / 401
again.

---

## Stop conditions — come back to the founder, do not assume

Every "stop" / "see Stop conditions" reference in this brief resolves here (including
Acceptance §4's *"If your implementation finds itself writing SQL, **stop**"*).

1. **You are about to write SQL, a migration, a table or an RLS policy.** Stop. Non-goal 1
   is absolute: this track touches no database. Needing one means the design drifted —
   report what pushed you there rather than shipping it.

2. **~~[BLOCKING — founder decision]~~ RESOLVED 2026-07-24 — `reauth` is `path: null` + a
   callback. No founder input needed; this was a factual contradiction, not a tradeoff.**
   Data contract C4 originally listed `reauth → { label: 'Sign in again', path: '/login' }`.
   Track `d-actionable-errors` ships a test asserting that for every action type,
   `actionPath(t)` is `null` or **a key of `PATH_TO_SECTION`** — the test it calls "the one
   that makes a dead link impossible to merge". Verified in
   `apps/web/src/redesign/routes.ts:8-22`: `/wallet` **is** a key; **`/login` is not** — it
   is a top-level page outside the shell, exactly like `/connect`. `path: '/login'` is
   therefore a dead link by D's own definition, and weakening D's invariant to admit one
   row trades away the guarantee for nothing.
   **Ruling: `reauth → { label: 'Sign in again', path: null }`, routed through the
   `onAction` callback** — exactly as this brief already does for `switch_workspace` and
   `retry_turn`. Step 7e *already* requires `reauth` to persist the transcript and seed
   `aros.chat.resumeId` **before** navigating, i.e. it is a callback with a side effect,
   not a plain link. `path: null` is the truthful encoding, D's invariant survives
   unweakened, and Step 7e's behaviour is unchanged (the callback ends with
   `window.location.assign('/login')`).
   **Record this ruling as a comment in `apps/web/src/aros-ai/actions.ts`** next to the
   `reauth` row when you extend `CHAT_ACTION_PRESENTATION` — track D creates the file, you
   extend it (Data contract C4, §Collision warnings register).

3. **~~[founder call]~~ RESOLVED for this package 2026-07-24 —
   `apps/web/src/aros-ai/ArosChat.tsx` is FROZEN. No track touches it, this one included.**
   Non-goal 5 was right and is now the package-wide rule. Verified first-hand: the file
   declares `ArosChat()` at `:41` and has **no import, no JSX usage, no mount** — five
   comment-only references and nothing else. `App.tsx:255` routes every onboarded
   authenticated path (`/chat` included) to `<AppShell />`; `AppShell.tsx:3,:240` mounts
   **`ConciergeChat`**, the only in-app chat a signed-in user can reach.
   Track D's step 7f (which instructed modifying it) is **removed**; track A's step 9
   ArosChat half is **removed**. Reason the rule is absolute: a diff to an unmounted
   component cannot be proven by any test any brief in this package ships.
   The remaining question — **delete it, mount it, or leave it with a `@deprecated`
   header** — is a genuine founder call and is written up in full in
   `d-actionable-errors.md` §Stop conditions #11. Do not answer it here.

4. **The E2E session seeding in Acceptance §6 cannot be made to work locally.** Do not
   delete the `x-idempotency-key` equality assertion or the fresh-token assertion to get a
   green run — a test that passes because its assertion never executed is worse than no
   test. Follow the documented fallback (mark the two specs beta-only, keep the pure
   `chatRecoveryLogic` cases as the merge gate) and say so in the PR.

5. **You conclude the fix requires a change in the `shreai` repo** — `requirePassport`, the
   idempotency window, or the router's error shapes. Stop and escalate (Non-goal 3). The
   whole design deliberately keeps the correction on the AROS side of the proxy hop.

6. **shre-router turns out to run multi-instance in prod.** §12 lists this as UNVERIFIED.
   The 60 s idempotency window is **in-memory** (`chat-proxy.ts:299`), so on multiple
   instances it is per-instance and the no-double-side-effect guarantee this track leans on
   is weaker than stated. That does not block the track — the client behaviour is strictly
   better either way — but it changes what the PR may *claim*. Get `pm2 list` /
   `systemctl status` from the router host before writing "guaranteed" anywhere.

7. **Anyone asks you to verify by signing in.** Refuse. An account-lockout risk is live on
   `npatel@rapidrms.com` (see Acceptance §7 and track E's Step 0). The read-only probe in
   §7 is the only live verification this track performs.
