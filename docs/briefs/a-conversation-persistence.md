# Build brief — Server-side conversation persistence (KEYSTONE)

**Slug:** `a-conversation-persistence`
**Repo:** `Nirlabinc/aros` (this repo)
**Executor:** Codex, assumed to have zero prior context on this codebase.
**Brief authored against:** aros `origin/main` @ `9b4a693` (verify with `git rev-parse origin/main`; if it differs, re-read every anchor below before editing).

---

## Track

AROS keeps **no server-side record of any user↔assistant conversation**. Every chat turn is answered and thrown away. This track adds two tables to the AROS Supabase — `chat_conversation` and `chat_message` — plus a write path at the single `/v1/chat` seam and two read surfaces, so the server owns the transcript instead of the browser.

**User-visible outcome:** a signed-in user's chat history survives a reload, a device change, and a "clear chat"; the founder can answer "what did users ask, what did they get, what failed" from SQL instead of guesswork; and track F can score evaluation batteries against *real* transcripts instead of synthetic re-asks.

**Why keystone:** every other observability track (eval, monitoring, quality regression) needs a durable, tenant-and-user-attributed transcript. Nothing else can be built until this exists.

---

## Verified ground truth

Every claim below carries a `path:line` anchor opened during authoring. **Anything I could not verify is marked UNVERIFIED with the check that would settle it.**

### 1. There is no chat/conversation/message table anywhere in AROS

`src/server.ts` on `origin/main` references exactly 23 Supabase tables via `.from('…')`:

```
audit_log, automation_fires, event_subscriptions, leads,
marketplace_app_entitlements, model_enrollments, notification_preferences,
onboarding_progress, platform_apps, platform_settings, store_snapshots,
store_sync_jobs, store_timecard_correction_requests, tenant_agents,
tenant_connectors, tenant_member_stores, tenant_members, tenant_resources,
tenants, user_experience_preferences, wallet_ledger, wallet_settings,
workspace_onboarding_state
```

(Reproduce: `grep -o "from('[a-z_]*'" src/server.ts | sort -u`.)

A grep for `chat_conversation|chat_message|conversation` across `db/` and `supabase/` `.sql` files returns **nothing**. There are 36 migrations in `supabase/migrations/`; none creates a chat table.

> **Note on the seed brief:** the seed listed `stores`, `store_connector_bindings`, and `tenant_app_data_bindings`. Those names do **not** appear in `from()` calls on main. The load-bearing conclusion is unchanged: zero chat tables.

**UNVERIFIED:** whether the *production* AROS Supabase already has a chat table created out-of-band (someone typing SQL into the Supabase editor). No live database read was performed. **To verify:** run, against prod with a read-only role,
`select table_name from information_schema.tables where table_schema='public' and table_name like 'chat%';`
Do this *before* step 1 (see Stop conditions).

### 2. The one seam every AROS chat turn passes through

`src/server.ts:6783`:

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

- Body is parsed **once** at `6784` (`parseJsonBody` is defined at `src/server.ts:1080`).
- Four AROS-local handlers get first refusal: `handleArosHealthPing` (`6785`, defined `4209`), `handleArosAutomationChat` (`6788`, defined `4632`), `handleArosStoreDataChat` (`6789`, defined `4844`), `handleArosSalesChat` (`6790`, defined `4232`).
- Only the fallthrough at `6791` reaches shre-router.
- The generic `/v1/*` proxy at `6794` explicitly excludes `/v1/traces/`.

**Consequence you must not miss:** each of the four local handlers answers with `json(res, 200, { content, _shre:{…} })` and `return true` — *they never touch shre-router.* Persistence hooked into `proxyRequest` would capture only the fallthrough and silently omit exactly the store-data and automation answers track F needs. Hook at the `/v1/chat` block.

Example local reply shape, `src/server.ts:4212-4221` (`handleArosHealthPing`):

```ts
  json(res, 200, {
    content: 'online',
    _shre: {
      model: 'aros-health',
      toolsUsed: [],
      mode: 'aros-health-direct',
      connected: true,
      ...(UUID_RE.test(tenantId) ? { tenantId } : {}),
    },
  });
```

and an error shape, `src/server.ts:4300-4303` region (`handleArosSalesChat` catch):

```ts
    json(res, 200, {
      content: 'RapidRMS sales data could not be retrieved right now.',
      _shre: { model: 'aros-store-data', toolsUsed: ['mib_sales_today'], mode: 'aros-sales-direct', error: 'sales_unavailable' },
    });
```

Note: **failures come back as HTTP 200 with `_shre.error`**. "What failed" must read `_shre.error`, not the status code.

### 3. The "extract the new turn" function already exists

`src/server.ts:4156`:

```ts
function chatLatestText(body: Record<string, unknown> | null): string {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i] as Record<string, unknown>;
    if (message?.role && message.role !== 'user') continue;
    const content = message?.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) { /* joins text parts */ }
  }
  return String(body?.message ?? body?.input ?? body?.prompt ?? '');
}
```

Reuse it. It already handles string content, array-part content, and the `message`/`input`/`prompt` fallbacks. It is the natural place the server stops trusting client history.

### 4. The tenant on the chat path today comes from the CLIENT, not from auth

`src/server.ts:4174`:

```ts
function arosChatTenant(req: IncomingMessage, body: Record<string, unknown> | null): string {
  // ...
  return String(
    body?.tenantId || body?.workspaceId || body?.tenant_id || body?.workspace_id ||
    header('x-aros-tenant-id') || header('x-workspace-id') || header('x-tenant-id') || '',
  ).trim();
}
```

`handleArosSalesChat` (`4234`) and `handleArosStoreDataChat` (`4847`) use this value directly after a UUID regex check (`UUID_RE` at `src/server.ts:3789`). Only `handleArosAutomationChat` cross-checks it against a real session — `src/server.ts:4646-4651`:

```ts
    const auth = await authenticateRequest(req);
    if (!auth || auth.tenantId !== tenantId) {
      // Fail closed: without a verified session there is no role, so no
      // rule management of any kind.
      return automationReply(res, tenantId, "I couldn't verify your sign-in …");
    }
```

**Therefore: the transcript's `tenant_id` must come from `authenticateRequest`, never from `arosChatTenant`.** A client-supplied tenant is an authority claim, and this repo already refuses to honour those (see §5).

### 5. The in-repo precedent for "don't trust the client's history"

The seed brief said this comment lives in shre-router. **It does not.** It lives in *this* repo, twice.

`src/server.ts:4287-4294` (banner above `handleArosAutomationChat`):

```
// Mission: docs/missions/aros-automation-rules.md. This slice registers,
// lists, disables, and deletes rules only — NO sentinel runs and NOTHING
// sends. The confirm flow is STATELESS: the confirm card embeds the proposed
// rule, and when the next user turn answers it, the payload is recovered from
// message history and RE-VALIDATED server-side (role, destination binding,
// caps, dupes) before any row is written — a tampered history cannot mint
// authority the user doesn't have.
```

`src/server.ts:4421-4423` (inside `saveConfirmedAutomation`, defined at `4414`):

```ts
  // Trust NOTHING that round-tripped through the client: re-derive the
  // destination from the authenticated user and whitelist the trigger, so a
  // tampered history cannot mint authority (see banner above handleArosAutomationChat).
```

It is enforced by pure-function tests at `src/__tests__/automation-rules.test.ts:121-130`. Cite this as established in-repo doctrine, not a new idea.

### 6. Authentication: the only server-side source of `(tenant_id, user_id)`

`src/server.ts:2534` declares `type AuthContext`; `src/server.ts:2557` defines:

```ts
async function authenticateRequest(req: IncomingMessage): Promise<AuthContext | null> {
  const oidcSession = await oidcRp.authenticate(req.headers.cookie);
  if (oidcSession) {
    const requestedTenantId = getRequestedTenantId(req);
    if (requestedTenantId && requestedTenantId !== oidcSession.workspaceId) return null;
    return { userId: …, tenantId: oidcSession.workspaceId, role: …, bundle: … };
  }
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;
  // … Supabase getUser(token) + active tenant_members row
}
```

Two paths: **OIDC session cookie first**, then a Supabase bearer token. `AuthContext` = `{ userId, tenantId, role, bundle }`.

It is **not** called on the `/v1/chat` route itself. It is called inside `handleArosAutomationChat` (`4646`) and inside `proxyRequest` (`948`) only when an `Authorization` header is present.

### 7. shre-router is structurally incapable of storing this correctly

`proxyRequest` at `src/server.ts:948`; the auth-termination block begins at `src/server.ts:971` with this comment:

```
  // Authenticate proxied router traffic. The router speaks PASSPORT JWTs
  // only — but signed-in browsers send their Supabase access token, and
  // forwarding that verbatim made every authed user's chat 401 while
  // anonymous demo chat (which got the service passport) worked. Terminate
  // user auth HERE: verify the Supabase token, swap in the service passport,
  // and carry the resolved tenant on x-tenant-id for cost attribution.
```

and at `src/server.ts:999`:

```ts
        const routerTenant = await routerTenantFor(auth.tenantId);
        headers.set('Authorization', `Bearer ${await passportForTenant(routerTenant)}`);
        if (!headers.has('x-tenant-id')) headers.set('x-tenant-id', routerTenant);
```

`routerTenantFor` is at `src/server.ts:803` and maps an AROS workspace UUID to a **warehouse id (`client-<N>`)**.

**Consequence:** shre-router never learns the AROS workspace UUID or the AROS user id. No router-side store can ever be RLS'd by AROS tenant AND user. This is a stronger argument for owning the transcript in the AROS Supabase than "the router's store is ephemeral."

### 8. Ephemeral alternatives that are NOT a substitute

**(a) AROS's own in-process trace surface.** `src/server.ts:6715`:

```ts
  if (pathname.startsWith('/v1/traces/') && method === 'GET') {
    const scope = await authenticateRequest(req);
    if (!scope) return json(res, 401, { error: 'Authentication required' });
  }
  if (url === '/v1/traces/recent' && method === 'GET')   return json(res, 200, getRecentTraces());
  if (url === '/v1/traces/failures' && method === 'GET') return json(res, 200, getRecentFailures());
  if (url === '/v1/traces/stats' && method === 'GET')    return json(res, 200, getTraceStats());
```

Backed by an in-memory store in the vendored shre client package. Per-replica, lost on restart, no transcript content.

**(b) shre-router's `chat-trace-store.ts`.** Verified in `Nirlabinc/shreai` `origin/main`:
`shre-router/src/chat-trace-store.ts:44` `const MAX_TRACES = 500;`, `:45` `const TRACE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours`, `:46` `const traces = new Map<string, ChatTrace>()`, and the stored prompt is truncated: `prompt: opts.prompt?.slice(0, 200)`. In-memory Map, ring-buffered, per-replica, restart-lossy, 200-char prompts, no reply body.

**(c) The CortexDB training pipeline.** **The seed brief was wrong here, and so was the recon pass** — this path *is* live. Verified in `Nirlabinc/shreai` `origin/main`:

- `packages/shre-sdk/src/training.ts:473` `export async function writeConversation(opts: {…})` → delegates to `writeTrainingData` with `tenantId: opts.tenantId || 'platform'`.
- `writeTrainingData` writes CortexDB `data_type` `training_record` (`packages/shre-sdk/src/training.ts:417`, `:430`).
- It **is** called from shre-router source: `shre-router/src/rag-injector.ts:142` (inside `learnFromConversation`), `shre-router/src/claude-executor.ts:117`, `shre-router/src/openai-executor.ts:164`, `shre-router/src/ellie-escalation.ts:847`.
- `learnFromConversation` is imported by `chat-streaming.ts:14`, `chat-cli-session.ts:5`, `conversation-task-loop.ts:16`, `ellie-escalation.ts:16`, `index.ts:98`.

So training records *are* being written — but they are **not a transcript**, for five independent reasons:
1. They only cover the *fallthrough* path. The three AROS-local handlers never reach shre-router (§2).
2. `learnFromConversation` **drops short exchanges** (`rag-injector.ts:89`: `if (userMessage.length < 20 && assistantResponse.length < 50) return;`) and **dedupes recently-seen exchanges** (`rag-injector.ts:93-97`). A store that deliberately discards rows is not a record.
3. The tenant it records is the *router warehouse* tenant (`client-<N>`) or literally the string `'platform'`, never the AROS workspace UUID (§7).
4. There is **no user id** anywhere in the payload — so it can never satisfy "RLS by tenant AND user."
5. It lands in a **separate CortexDB Postgres**, outside the AROS deploy unit. `shre-cortex-bridge/src/config.ts:41` defaults `port` to `5433` with database `cortexdb`, user `cortex`. That path is a **git submodule** of the shreai repo (not readable via `git show origin/main:…`; read from disk), i.e. separately versioned and separately deployed.

**(d) shre-router's conversation-memory vector store — flag, do not build on.** `shre-router/src/conversation-memory.ts:651`:

```ts
export function ingestConversationToVectors(
  sessionId: string,
  userMessage: string,
  assistantResponse: string,
  agentId: string,
): void {
  if (assistantResponse.length <= 50) return;
```

**No `tenantId` parameter.** It writes CortexDB vectors and `recallRelevantConversations` (`:465`) reads them back into the live system prompt, sanitized for prompt injection (`sanitizeRecalledContent`, `:30`) but **not partitioned by customer**, with a Tier-2 SQLite fallback at `join(homedir(), '.shre', 'chat-sessions.db')` (`:39`). This is an existing cross-tenant exposure surface adjacent to this track. **It is NOT this track's job to fix it, and AROS-owned persistence must not feed it.** Raise it with the founder as a separate finding.

**(e) Session threading is already broken end to end.** `shre-router/src/chat-proxy.ts:1447`:

```ts
    const chatSessionId = sessionId ?? `session-${Date.now()}`;
```

Neither authenticated AROS surface sends a `sessionId`, so every turn is assigned a fresh synthetic session. A server-issued `conversation_id` echoed by the clients fixes AROS persistence *and* unbreaks router-side threading — a two-for-one.

### 9. The four client chat surfaces (the seed knew about two)

> **CORRECTION (2026-07-24, verified first-hand — this row was wrong and it is load-bearing for this track).**
> `apps/web/src/aros-ai/ArosChat.tsx` is **UNMOUNTED DEAD CODE. It is not a live surface.**
> Verified by following the router from the app entry:
> - `grep -rn "ArosChat" apps/web/src` returns the declaration at `ArosChat.tsx:41` and **five comment-only mentions** (`CanvasContext.tsx:2,5`, `ChatMessageRenderer.tsx:16`, `chatTheme.ts:2`, `composerIcons.tsx:3`, `ConciergeChat.tsx:18`). **No import. No JSX usage. No mount.**
> - `apps/web/src/app/App.tsx:255` — `AuthenticatedRoutes` returns `<AppShell />` for **every** onboarded authenticated route, `/chat` included ("The chat-first shell owns every onboarded authenticated route"). `App.tsx:93-95` renders the same `<AppShell />` auth-free at `/preview/app`.
> - `apps/web/src/redesign/AppShell.tsx:3` imports `ConciergeChat` and `:240` mounts it inside the `mode === 'chat'` layer. **`ConciergeChat` is the only in-app chat a signed-in user can reach.**
>
> Consequences for this brief, all applied below: Step 3's canary no longer gates on ArosChat; Step 9 no longer edits ArosChat; Acceptance test E now drives `/chat` (ConciergeChat). **Do not edit `ArosChat.tsx` in this track** — see §Collision warnings, "Package file-ownership register".
>
> Knock-on for §4.1's `surface` CHECK: `'aros-chat'` is **unreachable** (dead component) and `'start-chat'` is unreachable under Non-goal 2 (anonymous turns dropped; `StartChat.tsx` sends no `Authorization` header). In practice only `'concierge'` is ever written. Keep the enum values — they cost nothing and a future mount would need them — but do **not** write an acceptance test that asserts `'aros-chat'`.

| Surface | File | Sends history? | Sends auth? | Session id? |
|---|---|---|---|---|
| ~~ArosChat (in-app widget)~~ **NOT MOUNTED — dead code, not a surface** | `apps/web/src/aros-ai/ArosChat.tsx` | n/a — never rendered | n/a | n/a |
| ConciergeChat (redesign) | `apps/web/src/redesign/ConciergeChat.tsx` | **Yes — the entire transcript, every turn** (`:115`) | Yes, Bearer + `x-tenant-id` (`:106-110`) | No |
| StartChat (demo/onboarding) | `apps/web/src/pages/start/StartChat.tsx` | No — latest turn only (`:139`) | No | **Yes** — `sessionId` (`:134`) |
| ChatWidget (public) | `apps/web/src/components/ChatWidget.tsx` | Yes — `messages.slice(-6)` (`:67`) | No | No |

Details:

`apps/web/src/aros-ai/ArosChat.tsx:15-16`:
```ts
const STORAGE_KEY = 'aros-chat-messages';
const MAX_STORED = 50;
```
persist at `:29` (`localStorage.setItem(STORAGE_KEY, JSON.stringify(msgs.slice(-MAX_STORED)))`), wiped at `:170` (`clearChat`). The request at `:120-127`:
```ts
      const res = await fetch(`${ROUTER_URL}/v1/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: 'aros-agent',
          messages: [{ role: 'user', content: text.trim() }],
          stream: false,
        }),
      });
```
`ROUTER_URL` defaults to `''` (`:38`) → **same-origin**, so `fetch`'s default `credentials: 'same-origin'` would send the OIDC session cookie. ~~**UNVERIFIED:** that `authenticateRequest(req)` actually resolves for a real ArosChat request in production.~~ **RESOLVED — the question is void:** the component is never mounted, so there is no such request and never will be until someone mounts it. The code block above is retained only as a record of what the dead file contains. **The live authenticated surface is `ConciergeChat`, which sends `Authorization: Bearer <supabase access_token>` (`ConciergeChat.tsx:104-110`) — the identity this track depends on is present by construction.**

`apps/web/src/redesign/ConciergeChat.tsx:115`:
```ts
            ...nextMessages.map(message => ({ role: message.from === 'me' ? 'user' : 'assistant', content: message.text })),
```
State initialised at `:54`, no localStorage, no conversation id, unbounded growth, lost on reload.

`apps/web/src/pages/start/StartChat.tsx:47`:
```ts
function getDemoSessionId(): string {
  try {
    let id = localStorage.getItem(DEMO_SESSION_KEY);
    if (!id) { id = `demo-${crypto.randomUUID()}`; localStorage.setItem(DEMO_SESSION_KEY, id); }
    return id;
  } catch { return `demo-${Math.abs(Date.now())}`; }
}
```
used at `:63` and sent at `:134`. This is the reusable client pattern for `conversation_id` — but **client-minted**, which contradicts §5. Generalize the *shape*, not the *authority*.

`apps/web/src/components/ChatWidget.tsx:61-67` posts to `${CHAT_API}/v1/chat/public` with `history: messages.slice(-6)`. There is **no `/v1/chat/public` handler in `src/`** — it falls through the generic `/v1/` proxy at `src/server.ts:6794`.

All four normalise the reply with `apps/web/src/lib/chatReply.ts:9` `chatReplyText(data)` — `pick(d.response) ?? pick(d.message) ?? pick(d.content) ?? 'No response received.'`.

### 10. `audit_log` — the "extend it instead?" evidence

`db/supabase-schema.sql:92-100`:
```sql
-- Audit log
CREATE TABLE audit_log (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id),
  user_id UUID REFERENCES auth.users(id),
  action TEXT NOT NULL,
  resource TEXT,
  detail JSONB DEFAULT '{}',
  ip TEXT,
  created_at TIMESTAMPTZ …
);
```
RLS enabled at `db/supabase-schema.sql:131`; the only policy, `db/supabase-schema.sql:183-188`:
```sql
-- Audit log: owner can read
CREATE POLICY audit_tenant ON audit_log
  FOR SELECT USING (
    tenant_id IN (SELECT id FROM tenants WHERE owner_id = auth.uid())
  );
```
**Owner-only. Not member. Not user-scoped.**

The writer, `src/server.ts:1120-1142`:
```ts
async function auditLog(opts: { tenantId?; userId?; action; resource?; detail?; ip? }): Promise<void> {
  try {
    const supabase = createSupabaseAdmin();
    await supabase.from('audit_log').insert({ … });
  } catch (err) {
    // Non-fatal — never block a request for audit logging
    console.error('[audit]', err instanceof Error ? err.message : err);
  }
}
```
Deliberately fire-and-forget and lossy.

### 11. Migration conventions this repo enforces

`scripts/check-migration-safety.mjs` (run via `pnpm check:migrations`, `package.json:23`) scans `supabase/migrations/*.sql` and **exits non-zero** on:
1. `CREATE TABLE public.<t>` with no `ENABLE ROW LEVEL SECURITY` for that table (`scripts/check-migration-safety.mjs:31-40`);
2. any `SECURITY DEFINER` view, or a `CREATE OR REPLACE VIEW public.<v>` that neither sets `security_invoker = true` nor is `REVOKE`d from `anon` (`:42-60`).

Canonical, most-recent migration style — `supabase/migrations/20260722_event_subscriptions.sql`: table `:10`, partial unique index `:39`, `(tenant_id, status)` index `:43`, RLS `:46`, member-read policy `:53`, grant `:57`. Its policy comment (`:48-51`) states the invariant to imitate:

```sql
-- Tenant members can READ their workspace's rules (list is member-visible).
-- ALL writes go through the platform server with the service role so the
-- owner/admin gate, destination binding, caps, and fingerprint checks are
-- always enforced server-side — no client write path exists.
DROP POLICY IF EXISTS event_subscriptions_member_select ON public.event_subscriptions;
CREATE POLICY event_subscriptions_member_select ON public.event_subscriptions FOR SELECT USING (
  tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid() AND status = 'active')
);
GRANT SELECT ON public.event_subscriptions TO authenticated;
```

Newest migration `supabase/migrations/20260723_wallet.sql` uses the same posture (RLS `:38-39`, member-read `:42`/`:46`, `GRANT SELECT … TO authenticated` `:50-51`, no authenticated write path).

Retention patterns already in-repo — pick one, do not invent a third:
- `supabase/migrations/20260717_public_commerce.sql:102` — plain SQL `purge_expired_cart_drafts() RETURNS integer`, called best-effort by the API, cron-safe.
- `supabase/migrations/20260716_oidc_rp_sessions.sql:29-34` — `cleanup_oidc_rp_state()` `SECURITY DEFINER SET search_path=public`, `REVOKE ALL … FROM PUBLIC`, `GRANT EXECUTE … TO service_role`.

**There is no migration runner.** `package.json` scripts are `build, dev, lint, typecheck, clean, update:core, marketplace:sync, identity:claim-queue, identity:shre-id-sync, security:auth, test:auth-conformance, serve, check:migrations, e2e`. Migrations are applied **by hand** in the Supabase SQL editor. `supabase/catchup/20260715_prod_catchup.sql` exists precisely because prod drifted from the repo.

### 12. The founder monitoring console IS wired — correcting the recon pass

The recon pass asserted `/api/platform` is unwired. **That is wrong.** Verified:

`src/server.ts:7076-7077`:
```ts
  const platformMatch = pathname.match(/^\/api\/platform\/(overview|tenants|audit)(?:\/([0-9a-f-]+))?$/);
  if (platformMatch && method === 'GET') return handlePlatformConsole(req, res, platformMatch[1], platformMatch[2]);
```

`src/server.ts:3380-3396`:
```ts
// ── Platform console (founder-only, read-only) ──────────────────
// Cross-tenant visibility for the platform operator. Gated by the
// PLATFORM_ADMIN_EMAILS allow-list (see src/platform-admin.ts) — empty env
// means these routes 404 like the feature doesn't exist. v1 is strictly
// read-only; any future mutating action gets its own explicit route + audit.

const platformAdmins = parsePlatformAdmins(process.env.PLATFORM_ADMIN_EMAILS);

async function requirePlatformAdmin(req, res): Promise<{ userId; email } | null> {
  if (platformAdmins.size === 0) { json(res, 404, { error: 'not found' }); return null; }
  const auth = await authenticateRequest(req);
  if (!auth) { json(res, 401, { error: 'Authentication required' }); return null; }
  const supabase = createSupabaseAdmin();
  const { data } = await supabase.auth.admin.getUserById(auth.userId);
  const email = data?.user?.email || null;
  if (!isPlatformAdmin(email, platformAdmins)) { json(res, 404, { error: 'not found' }); return null; }
  return { userId: auth.userId, email: email as string };
}
```

`handlePlatformConsole` is at `src/server.ts:3398`, and it audits every access at `src/server.ts:3402`:
```ts
  await auditLog({ userId: admin.userId, action: 'platform.console_access', resource: tenantId ? `${section}:${tenantId}` : section, detail: {}, ip: getClientIp(req) });
```
Pure gate functions live in `src/platform-admin.ts`, tested in `src/__tests__/platform-admin.test.ts`. The client is `apps/web/src/pages/PlatformConsole.tsx:49`:
```ts
    const res = await fetch(`${API_BASE}/api/platform${path}`, { headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {} });
```

**So the monitoring read surface has a real, audited, founder-gated home.** Extend this route, do not build a new console.

**UNVERIFIED:** whether `PLATFORM_ADMIN_EMAILS` is set in the production environment (if unset, all these routes 404 by design). **To verify:** ask the founder, or check the prod `.env` on the deploy host read-only.

### 13. Functional-core precedent to copy

`src/automation/rules.ts:1-8`:
```
/**
 * Automation rules — pure functional core (no I/O).
 *
 * Fingerprinting, confirm-card rendering, stateless confirm-flow detection,
 * and create-precondition evaluation for chat-registered automation rules.
 * The imperative shell (src/server.ts) does all reads/writes; everything here
 * is deterministic data-in/data-out …
 */
```
Imported into the shell at `src/server.ts:74`. Its tests are plain-assert vitest at `src/__tests__/automation-rules.test.ts`.

The only redaction helper anywhere in `src/` is `src/automation/rules.ts:98` `maskDestination(channel, destination)` — for **display** of phone/email, not for storage. **There is no PAN redaction helper in this repo** (verified again 2026-07-24: `src/chat/` does not exist and no `redactPan`/`redactPii`/Luhn code is present anywhere in `src`, `scripts`, `apps/web/src` or `packages`). **The package writes exactly ONE**, and this track does not own it: `src/chat/redact.ts` `redactPan`, spec in `d-actionable-errors.md` §Data contract 6a, shared fixtures in `src/chat/__fixtures__/pan-redaction.json`. Import it (§4.2). If it has not landed when you get here, create it exactly as §6a specifies — do **not** invent a variant. Three briefs each writing their own is the defect this rule exists to prevent.

Test runner config, `vitest.config.ts`:
```ts
    include: [
      'src/**/__tests__/**/*.test.ts',
      'appfactory/**/__tests__/**/*.test.ts',
      'apps/web/src/onboarding/**/*.test.ts',
      'apps/web/src/redesign/routes.test.ts',
      'apps/web/src/redesign/pages/connections/appsLogic.test.ts',
      'apps/web/src/redesign/pages/admin/profileLogic.test.ts',
    ],
```
There is **no `test` script** in `package.json` and no local `node_modules/.bin/vitest` in this worktree. Run tests with `pnpm exec vitest run <path>` (install first: `pnpm install`).

### 14. Golden-record layer — bind, never fork

`src/golden/store.ts:11` `export function createGoldenStore(): GoldenStore`, `src/golden/resolve.ts:68` `export async function resolveCanonical(store, input)`. `chat_conversation` must key on `public.tenants(id)` and `auth.users(id)` exactly like `event_subscriptions` and `wallet_ledger`. **Do not create any alias/identity table.** Customer linkage, if ever needed, goes through `resolveCanonical`. A second identity path is an automatic stop.

### 15. Track F's consumer

`scripts/chat-eval/` contains `run.mjs` (imperative shell), `core.mjs` (pure), `core.test.mjs`, `battery.json`, `triage.mjs`, `triage-core.mjs`, `README.md`.
`scripts/chat-eval/core.mjs` exports pure functions at `:18 getPath`, `:23 currencyPattern`, `:31 isEmptyReply`, `:39 hasErrorPhrase`, `:48 scoreReply(question, reply, groundTruth, opts)`, `:116 aggregate(scores)`, `:131 renderReport({…})`.
`run.mjs:14-16` documents that `--all` mode mints sessions via **Supabase admin magiclink**. Feeding stored rows to `scoreReply` removes that need — which also sidesteps the live account-lockout hazard flagged in track E.

#### 15.1 The reciprocal ask — what track F needs from THIS schema (agreed, do not renegotiate)

Track F's brief (`docs/briefs/f-real-transcript-eval.md` § Data contract 1) lists
columns it needs. That list was written before this schema existed, so it used
proposal names. **This table is the reconciliation. The names on the left are the
real columns in §4.1 and are the ones both briefs now use.** Track F's brief has
been corrected to match; if you find a brief still saying `chat_turns`,
`turn_index` or `resolved_model`, it is stale — the authority is §4.1.

| Real column in `public.chat_message` (§4.1) | Track F's old proposal name | Why F needs it |
|---|---|---|
| `id uuid` PK | `id` | FK target for `chat_grades.turn_id` |
| `tenant_id uuid NOT NULL` | `tenant_id` | tenant attribution; as-of join to `store_snapshots` |
| `user_id uuid NOT NULL` | `user_id` | erasure is per user |
| `conversation_id uuid NOT NULL` | `conversation_id` | groups turns; pairs question ↔ reply |
| **`seq integer NOT NULL`** | ~~`turn_index`~~ | orders turns within a conversation |
| `role text NOT NULL` | `role` | pairs the user turn with the next assistant turn |
| `content text NOT NULL` | `content` | the text being graded |
| `created_at timestamptz NOT NULL` | `created_at` | derives `business_date` for as-of truth |
| `latency_ms integer` | `latency_ms` | feeds `opts.latencyMs` → `core.mjs:108` slow check |
| `http_status integer` | `http_status` | separates a transport failure from a bad answer |
| **`model text`** | ~~`resolved_model`~~ | attributes a failure to a model lane |
| **`from_cache boolean NOT NULL DEFAULT false`** | `from_cache` | **added for F.** Excludes cached replies from every ground-truth check |
| **`trace_id text`** | `trace_id` | **added for F.** Only durable join key to shre-router's 2h trace buffer |
| **`error_code text`** | *(not asked for; F used prose matching instead)* | **the typed tool-failure signal.** See below |
| **`zero_type text`** | *(new)* | track C's typed zero taxonomy |
| **`self_check text[]`** | *(new)* | track C's reply-gate reasons |

**Why the last three matter more than they look.** Track F's old aros#168
("tool-error") detector was `hasErrorPhrase()` — substring matching on reply
wording (`'try again later'`, `'contact an administrator'`). Track C is deleting
exactly those phrases from `scripts/chat-eval/core.mjs` and rewriting the AROS
handlers so a data failure is emitted as a **typed** zero instead of an apology.
A wording-based detector would therefore go quietly blind. `error_code`,
`zero_type` and `self_check` are the structured replacement, and this schema is
the only place they can be captured — they exist only in the live `_shre`
envelope at the `/v1/chat` seam. **Persist them or track F cannot detect tool
errors at all.**

**Retention interaction.** Track F's `public.chat_grades` references
`chat_message(id)` with **`ON DELETE SET NULL`**, deliberately not `CASCADE`, so
`purge_expired_chat_transcripts()` cannot destroy the quality history. See §4.1
"Retention vs. track F's grading ledger". Do not "fix" that FK to a cascade.

---

## Depends on / blocks

**Depends on:** nothing for the schema itself. **One agreed input:** the four
typed observability fields (`from_cache`, `trace_id`, `zero_type`, `self_check`)
are populated from the `_shre` envelope that track `c-honest-data-contract`
stamps. Track C lands before track A in the `/v1/chat` dispatch block, so they
are available; if track C has not landed, `zero_type`/`self_check` are simply
`null` and nothing breaks. **The columns ship regardless** — they are cheap and
nullable now, and a second hand-applied migration against prod later (step 2) is
not.

**Blocked BY, in the `/v1/chat` dispatch block (`src/server.ts:6783-6792`) — RESOLVED 2026-07-24:**
the declared merge order for that block is **C → D → I → A**. Four tracks rewrite
those nine lines; this track is **last** and wraps whatever chain exists rather
than re-emitting the four-handler snippet. Separately, **B(1–3) → A** in
`proxyRequest` (`:948-1034`) — a different region, and the reason "A is the
keystone that starts first" and "A lands last in the dispatch block" are both
true without contradiction. Full table: §Collision warnings → Package
file-ownership register.

**Blocks:**
- `f-real-transcript-eval` — cannot score real transcripts until `chat_message` exists and is populated. F's full column contract is reconciled in §15.1; **F's FK targets `public.chat_message(id)`, and F's migration is named `20260725_chat_grades.sql` so it sorts after `20260724_chat_transcripts.sql`.**
- any chat-quality-monitoring / "what failed" track — the `/api/platform/conversations` read surface added in step 8 is its data source.
- any future "resume my conversation on another device" product work.

**Adjacent, explicitly NOT blocked by this track:** the shre-router `conversation-memory.ts` tenant-blindness finding (§8d). Report it; do not fix it here.

---

## Bind to the AI activity spine — STOP CONDITION, read before step 1

**This track is the AROS half of a live concurrent mission.** Read
`COORDINATION-ai-activity-spine.md` in this folder first. The contract is
`shre-dev-kit/docs/missions/ai-activity-spine.md` on branch
`feat/ai-activity-spine-mission` (commits `4dbc058`, `8f20058`; read it with
`git show feat/ai-activity-spine-mission:docs/missions/ai-activity-spine.md` —
**never** check that branch out in a shared checkout). Its increment 5 is
literally *"AROS emitter — attribution must be created, nothing persisted
today"*: that is this brief.

**Inventing a second attribution path is a stop condition**, with the same force
as the standing rule against forking `canonical_entity` (§14). Not a preference,
not a rebase problem — stop and escalate.

### What the spine fixes as the actor stamp

The spine's envelope (mission §"Expected outputs" 1; increment 1 is already
shipped — meter 66/66, sdk 28/28) is:
`product`, `event_type` (`chat_turn` | `task_start` | `task_complete` |
`tool_call`), `actor_user_id`, `actor_id_source`, `workspace_id`, `trace_id`,
`outcome`, plus the existing cost/token/model/agent columns. Its failure signal
is explicit: *"Any AI action executes with no actor stamp → that is a bug, not a
default."*

The reference implementation is **Centrix**, which the mission calls *"the
reference shape, not a gap"*: `centrix/server/ai-executor.ts:58-134`
(`aiConversations` scoped by `workspaceId` **and** `userId`) and `logAction` at
`:808` (a workspace+user audit row). `centrix/shared/schema.ts:2166` shows both
columns `notNull()` with FKs to `workspaces.id` / `users.id`.

### Column-by-column binding, and every divergence justified

| Spine envelope field | This track's column | Binding / justification |
|---|---|---|
| `workspace_id` | `tenant_id uuid NOT NULL REFERENCES public.tenants(id)` — on **both** `chat_conversation` and `chat_message` | **Same concept, AROS-local name.** AROS's tenancy table is `public.tenants` and every existing table in this repo (`event_subscriptions`, `wallet_ledger`, `audit_log`) says `tenant_id`. Renaming the column to `workspace_id` here would fork AROS's own vocabulary to match another product's. The emitter maps `workspace_id: row.tenant_id` at the seam — **one mapping line, in one place**, not a second identity model. Denormalised onto `chat_message` deliberately (RLS + tenant-ranged scans without a join); the writer keeps it consistent and it is never sourced from the client. |
| `actor_user_id` | `user_id uuid NOT NULL REFERENCES auth.users(id)` — on **both** tables | Same concept. NOT NULL is the whole point: v1 persists authenticated turns only (§Non-goals), so there is no "attributed to nobody" row. Sourced **only** from `authenticateRequest(req)` (§6), never from the request body (§4 — the body's tenant is client-supplied and untrusted). |
| `actor_id_source` | `meta.actor_id_source` on `chat_conversation` (jsonb, non-authoritative) | **Divergence, justified.** Today AROS has exactly one server-side identity source — the Supabase session resolved by `authenticateRequest` — so a dedicated column would be a constant. Record it as `'supabase-session'` in `meta` so the value exists for the emitter and for the day shre-id lands (`stm-aros-mib-experience-routing`), and promote it to a column then. Never read it for authorization. |
| `product` | not stored | Constant `'aros'` for every row in these tables. Storing a constant is noise; the emitter supplies it. |
| `event_type` | derived: `'chat_turn'` per assistant row | These tables store chat only. The emitter maps `role = 'assistant'` → `chat_turn`. |
| `trace_id` | `chat_message.trace_id text` | **Same column, one meaning.** Added for track F as the join key to shre-router's 2h trace buffer; it is *also* the spine's `trace_id`. Do not add a second trace column. |
| `outcome` | derived from `error_code` + `http_status` (+ `zero_type` when track C has landed) | `null` error_code and 2xx → `ok`; otherwise the error code. AROS-local handlers answer **HTTP 200 with `_shre.error`** (§4.1 comment), so `outcome` must not be derived from the status code alone. |
| cost / tokens | **not stored, and not assumed to exist** | Per COORDINATION: `runUsageInvoicing` and `workspaceUsageUsd` read `summary.totalBilledUsd`, a field no shre-meter runtime has ever returned, so AROS has never billed a dollar. **Treat `cost_events` as EMPTY.** No column here may be justified by "metering will fill it". |

### Persistence stays append-only — the other half of the ruling

COORDINATION's ruling, restated here because it is binding on this brief:
**adopt Centrix's attribution, reject Centrix's storage.** `ai_conversations` is
one jsonb blob per (workspace, user) that (a) drops all but the last 20 turns on
every write (`CONVERSATION_MEMORY_LIMIT = 10`, `ai-executor.ts:48`) and (b)
**DELETEs the whole row after 30 minutes idle** (`CONVERSATION_EXPIRY_MS`,
`:49`). It is a rolling context window for the model, not a transcript store.
Copying it would rebuild the exact gap this track exists to close.

So: **append-only, one row per message, under a `conversation_id`, never trimmed
on write, never destroyed by a TTL side effect** (§4.1). Retention is an
explicit, auditable, founder-ratified policy (`CHAT_RETENTION_DAYS`,
`purge_expired_chat_transcripts()`), not a cache eviction. The model's context
window is **derived** from the durable rows at read time (step 10,
`loadConversationHistory(…, 20)`) — which gives Centrix's behaviour for free
without making destruction the storage engine's default.

### What this track does NOT do

- It does **not** create an `activity_events` table, an AROS-local activity
  feed, or any second attribution store. The spine owns that (`shre-meter`).
- It does **not** put prompt or response bodies anywhere near the spine
  envelope. The mission's failure signal is explicit: *"Envelope found carrying
  prompt/response bodies."* Content lives **only** in `chat_message`, under this
  repo's RLS and retention. Conversation-content persistence is listed in the
  mission's own **Out** scope — the spine gives it a place to land, it does not
  own it.
- It does **not** touch `shre-meter`, `shre-sdk/src/cost.ts`, `toMeterEvent()`,
  `summary-range.mjs`, or the 4 AROS billing call sites. Branch
  `shreai/fix-meter-summary-contract` is open on those and is owned by the other
  session (COORDINATION §"Hands off").

### The emit seam (one function, flag-off) — and the founder question it carries

Wire the emit as **one call site**, in `persistTurn` (§4.3) after the rows are
written, behind `process.env.CHAT_ACTIVITY_EMIT === '1'`, **default off**:

```ts
// Single AI-activity emit seam for AROS chat. Fire-and-forget, never blocks or
// fails a turn (spine failure signal: "emitter latency or failure ever affects
// a user-facing response"). Derives EVERY field from the row just written —
// there is no second source of attribution.
if (process.env.CHAT_ACTIVITY_EMIT === '1') void emitChatActivity(assistantRow);
```

Keeping it to one flagged seam means the day the spine's increment 5 lands it is
a one-line flip, not a re-attribution project — and until then AROS has an actor
stamp on durable rows rather than a half-wired emitter pointed at a service that
is **not running and has no data** (mission D5).

> 🔴 **BLOCKING QUESTION (founder) — also recorded in § Stop conditions Q7.**
> Does track A *ship* the spine emitter (mission increment 5), or stop at the
> actor stamp + the flagged seam above?
> **Recommendation: stop at the actor stamp and the flag-off seam.** The emit
> target is unresolved through no fault of this track — the shre-meter runtime
> question is an open founder decision (`server.mjs`/Postgres vs
> `src/index.ts`/Hono), the SDK fix that makes an attributed event landable is
> unmerged on another session's branch, and shre-meter is not running with an
> empty `cost_events`. Shipping an emitter against an unknown surface is how a
> second attribution path gets born. **Do not answer this by picking a runtime.**

---

## Data contract

### 4.1 Migration — `supabase/migrations/20260724_chat_transcripts.sql`

Create this file. Style is copied from `supabase/migrations/20260722_event_subscriptions.sql` and `20260723_wallet.sql`. **RLS is in the same migration** — `pnpm check:migrations` will fail the PR otherwise (§11).

```sql
-- Server-owned chat transcripts (track a-conversation-persistence).
--
-- INVARIANT 1 — the server owns the transcript. Every row is written by the
-- platform server with the service role, from the authenticated session, at
-- the single /v1/chat seam (src/server.ts, the `pathname === '/v1/chat'`
-- block). There is NO authenticated write path: a tampered client history
-- cannot mint a transcript, exactly as a tampered history cannot mint an
-- automation (src/server.ts, banner above handleArosAutomationChat).
--
-- INVARIANT 2 — transcripts are the highest-PII surface in AROS. A workspace
-- member's chat can name customers, phone numbers and employees. Read is
-- therefore USER-SCOPED (user_id = auth.uid()), NOT member-scoped like
-- event_subscriptions/wallet_ledger and NOT owner-scoped like audit_log.
-- Cross-user reads happen only through the founder console
-- (/api/platform/conversations), which runs with the service role and writes
-- an audit_log row for every access.
--
-- INVARIANT 3 — content is redacted BEFORE insert, using the package's SINGLE
-- PAN primitive: redactPan from src/chat/redact.ts (spec: brief D §Data
-- contract 6a, Luhn-gated, fixtures in src/chat/__fixtures__/pan-redaction.json).
-- src/chat/transcript.ts imports it; it does NOT define its own. No PAN is ever
-- stored, logged, or returned.
--
-- INVARIANT 4 — ACTOR STAMP (ai-activity-spine). Every row in both tables
-- carries tenant_id (= the spine's workspace_id) AND user_id, NOT NULL and
-- FK-enforced. There is exactly ONE attribution path in AROS. See the brief's
-- "Bind to the AI activity spine" section — a second one is a stop condition.
--
-- INVARIANT 5 — STORAGE SHAPE. Append-only, one row per message, under a
-- conversation_id. Never trimmed on write, never destroyed by a TTL side
-- effect. Centrix's jsonb-blob + 30-minute-idle DELETE is adopted for
-- ATTRIBUTION only and REJECTED for PERSISTENCE (COORDINATION-ai-activity-spine.md).

-- ── Conversations ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.chat_conversation (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- The authenticated user who owns this thread. NOT NULL: v1 persists
  -- authenticated turns only (see the brief's "Anonymous surfaces" decision).
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Which client produced it. Free-text would rot; CHECK keeps it a closed set.
  -- Derived by resolveSurface() in src/chat/transcript.ts (§4.2) — client-declared,
  -- header fallback, then 'unknown'. DIAGNOSTIC ONLY: never read for authorization.
  -- A surface no client declares is simply never written; that is not a defect.
  surface       text NOT NULL CHECK (surface IN ('aros-chat','concierge','start-chat','api','unknown')),
  title         text,
  message_count integer NOT NULL DEFAULT 0,
  started_at    timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz NOT NULL DEFAULT now(),
  -- Retention: set at insert to started_at + CHAT_RETENTION_DAYS. Stored (not
  -- computed) so the founder can extend one thread without a schema change.
  expires_at    timestamptz NOT NULL,
  -- Non-authoritative diagnostics only. Never read for authorization.
  meta          jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- ── Messages ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.chat_message (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.chat_conversation(id) ON DELETE CASCADE,
  -- Denormalised for RLS and for time-ranged tenant scans without a join.
  -- Kept consistent by the writer; never sourced from the client.
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  seq             integer NOT NULL,
  role            text NOT NULL CHECK (role IN ('user','assistant')),
  content         text NOT NULL,
  -- Answer attribution. NULL means "the envelope did not carry it" — NEVER
  -- invent a default. The four AROS-local handlers set fixed model strings
  -- ('aros-health','aros-store-data','aros-automation'); the router path
  -- carries _shre.{model, mode, toolsUsed, decisionTrace.agentId}.
  model           text,
  mode            text,
  agent_id        text,
  tools_used      text[],
  -- "What failed": AROS-local handlers answer HTTP 200 with _shre.error
  -- (e.g. 'sales_unavailable'), so failure is NOT visible in the status code.
  error_code      text,
  http_status     integer,
  latency_ms      integer,
  -- ── Typed observability fields — CONSUMED BY TRACK F (§15) ──────────────
  -- These are REAL COLUMNS, not probes into `shre` below. Track F filters,
  -- groups and excludes on them in SQL, and — by explicit contract — must
  -- never re-derive any of them by matching the wording of a reply. Track C
  -- is deleting the reply wording these used to be inferred from, so a
  -- prose-based detector would break silently. All four are additive and
  -- nullable/defaulted: applying them costs nothing and adding them later
  -- costs a second hand-applied migration against prod (step 2).
  --
  -- true when shre-router served this reply from its response cache
  -- (_shre.from_cache, or the upstream `X-Cache: HIT` header). The router's
  -- cache key has NO tenant component, so a cached reply may have been
  -- generated for a different workspace — track F excludes these rows from
  -- every ground-truth comparison.
  from_cache      boolean NOT NULL DEFAULT false,
  -- shre-router trace id for this turn. The router's trace buffer is
  -- in-process with a 2h TTL, so the id must be captured at write time or the
  -- failure evidence is unrecoverable.
  trace_id        text,
  -- Track C's typed zero taxonomy, from _shre.dataSource.zero. One of
  -- not_permitted | connector_down | unsupported_connector | out_of_range |
  -- sync_stale | mapper_drift | genuine_zero. NULL = the reply carried no
  -- data envelope (LLM lane, or a turn written before track C landed).
  -- Deliberately NO CHECK constraint: track C owns that vocabulary, and a
  -- CHECK here would turn a track-C vocabulary addition into a migration.
  zero_type       text,
  -- Track C's reply-gate result, from _shre.selfCheck: the gate's own reason
  -- families. '{}' = gate ran and found nothing; NULL = gate did not stamp
  -- this turn. Those two are DIFFERENT — never conflate them.
  self_check      text[],
  -- Raw, redacted _shre envelope for forensics. Unindexed by design.
  shre            jsonb,
  -- Optional client-supplied idempotency token (double-submit protection).
  client_turn_id  text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL
);

-- ── Indexes, sized to the four read patterns ─────────────────────────────
-- (1) Read one thread in order — also the idempotency guard for retries.
CREATE UNIQUE INDEX IF NOT EXISTS chat_message_conversation_seq
  ON public.chat_message(conversation_id, seq);
-- (2) Double-submit protection when the client supplies a turn id.
CREATE UNIQUE INDEX IF NOT EXISTS chat_message_client_turn
  ON public.chat_message(conversation_id, client_turn_id)
  WHERE client_turn_id IS NOT NULL;
-- (3) "My recent conversations" (the authenticated read surface).
CREATE INDEX IF NOT EXISTS chat_conversation_user_recent
  ON public.chat_conversation(user_id, last_message_at DESC);
-- (4) "This workspace's recent conversations" (founder console, per-tenant).
CREATE INDEX IF NOT EXISTS chat_conversation_tenant_recent
  ON public.chat_conversation(tenant_id, last_message_at DESC);
-- (5) Time-ranged tenant scans: track F sampling + "what did users ask".
CREATE INDEX IF NOT EXISTS chat_message_tenant_time
  ON public.chat_message(tenant_id, created_at DESC);
-- (6) "What failed" — small partial index, not a scan of every reply.
CREATE INDEX IF NOT EXISTS chat_message_failures
  ON public.chat_message(tenant_id, created_at DESC)
  WHERE role = 'assistant' AND error_code IS NOT NULL;
-- (7) Retention sweeps.
CREATE INDEX IF NOT EXISTS chat_conversation_expiry ON public.chat_conversation(expires_at);
CREATE INDEX IF NOT EXISTS chat_message_expiry      ON public.chat_message(expires_at);

-- ── RLS (same migration — check:migrations enforces this) ────────────────
ALTER TABLE public.chat_conversation ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_message      ENABLE ROW LEVEL SECURITY;

-- A user reads their OWN threads, and only inside a workspace they are still
-- an active member of. Losing membership revokes access to the transcript
-- without deleting it. Deliberately NOT the member-read policy used by
-- event_subscriptions/wallet_ledger: a colleague must not read your chat.
DROP POLICY IF EXISTS chat_conversation_own_select ON public.chat_conversation;
CREATE POLICY chat_conversation_own_select ON public.chat_conversation FOR SELECT USING (
  user_id = auth.uid()
  AND tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid() AND status = 'active')
);

DROP POLICY IF EXISTS chat_message_own_select ON public.chat_message;
CREATE POLICY chat_message_own_select ON public.chat_message FOR SELECT USING (
  user_id = auth.uid()
  AND tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid() AND status = 'active')
);

-- Reads only. All writes go through the platform server with the service
-- role — no INSERT/UPDATE/DELETE policy exists, so authenticated clients
-- cannot write, edit or delete a transcript row directly.
GRANT SELECT ON public.chat_conversation TO authenticated;
GRANT SELECT ON public.chat_message      TO authenticated;
REVOKE ALL ON public.chat_conversation FROM anon;
REVOKE ALL ON public.chat_message      FROM anon;

-- ── Retention ────────────────────────────────────────────────────────────
-- Shape copied from public.cleanup_oidc_rp_state (20260716_oidc_rp_sessions.sql:29):
-- SECURITY DEFINER, REVOKE'd from PUBLIC, granted to service_role only.
-- Called best-effort by the platform server (see purgeExpiredTranscripts) and
-- safe to run from a scheduled job.
--
-- SCOPE — this function deletes RAW TRANSCRIPT TEXT ONLY. It must never be
-- widened to public.chat_grades (track F's quality ledger). That table holds
-- derived scores keyed by turn id and NO conversation text; its FK is
-- ON DELETE SET NULL, not CASCADE, precisely so a routine 90-day purge of
-- transcripts does not also erase the quality-trend history. If you add a
-- table to this DELETE list, you are changing a retention policy — go to
-- Stop conditions first.
CREATE OR REPLACE FUNCTION public.purge_expired_chat_transcripts()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE deleted integer;
BEGIN
  DELETE FROM public.chat_message      WHERE expires_at <= now();
  DELETE FROM public.chat_conversation WHERE expires_at <= now();
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END; $$;
REVOKE ALL ON FUNCTION public.purge_expired_chat_transcripts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_expired_chat_transcripts() TO service_role;
```

**Retention posture:** default **90 days**, hard delete, driven by `expires_at` written at insert from `CHAT_RETENTION_DAYS` (default `90`). Rationale: track F needs a window wide enough to be representative across seasonal retail questions; privacy wants the shortest window that satisfies that. There is no other PII-retention precedent in the repo (the only precedents are minutes/hours: `oidc_rp_sessions`, cart drafts). **90 days is a proposal requiring founder ratification — see Stop conditions.**

**Retention vs. track F's grading ledger — resolved, do not re-litigate.** The
nightly purge above is a *routine* rolling delete, not just a GDPR path. Track F
grades these rows and writes `public.chat_grades`. If that ledger cascaded from
`chat_message`, every quality trend older than `CHAT_RETENTION_DAYS` would be
destroyed by routine housekeeping and the whole "is chat getting better?"
question would be unanswerable beyond 90 days. **Mechanism:** `chat_grades`
stores *derived scores keyed by turn id* — verdict, reason families, intent
cluster, tier, fingerprint, `business_date`, `tenant_id` — and **no conversation
text, no `user_id`, no question, no reply excerpt**. Its `turn_id` FK is
`ON DELETE SET NULL` (track F Data contract §2), so this purge nulls the pointer
and leaves the score. Nothing that survives the purge can be traced back to a
person, so the ledger outliving the transcript is not a retention leak — it is
the same posture as keeping an aggregate after deleting the source rows. Track A
must **not** delete, cascade to, or otherwise touch `chat_grades`.

**PII posture:**
- `redactPan()` — **imported from `src/chat/redact.ts`, the package's single PAN primitive (brief D §Data contract 6a); this track does not define one** — runs on both the user text and the reply text **before** the insert, never after.
- The raw `_shre` envelope is redacted with the same function before being stored in `shre`.
- No IP address is stored on the transcript (it already lives on `audit_log`).
- Nothing from the golden-record layer is denormalised into these tables (§14).
- A user can hard-delete their own conversation via `DELETE /api/chat/conversations/:id` (step 7) so "clear chat" stops lying to the user.

**Why new tables and not an extension of `audit_log`** — three independent reasons, each grounded in §10:
1. **Retention class conflict.** An audit ledger is append-only and retained for compliance; a transcript is PII that must expire and be deletable on request. Merging them makes "delete my chat" mean "tamper with the audit trail."
2. **RLS shape conflict.** `audit_log`'s only policy is owner-only (`db/supabase-schema.sql:184`). Transcripts must be user-scoped. You cannot have both policies on one table without the owner policy leaking every member's private chat.
3. **Read-pattern conflict.** Track F and the monitoring view need `(conversation_id, seq)` ordering and time-ranged tenant scans with a failure-only partial index. `audit_log` has no ordering-within-a-thread column, no role, no model/latency/error columns, and its `detail` jsonb is unindexed under a `BIGSERIAL`. Serving these reads from it is a rewrite, not an extension.

**What `audit_log` keeps:** the *events*, not the content — `chat.conversation_started`, `chat.transcript_read` (founder console), `chat.transcript_deleted`, `chat.tenant_claim_mismatch`. Use the existing `auditLog()` (`src/server.ts:1120`) unchanged.

### 4.2 New module — `src/chat/transcript.ts`

Functional core. **No imports from `@supabase/supabase-js`, no `fetch`, no `process.env` reads inside the pure functions.**

```ts
/**
 * Chat transcripts — pure functional core (no I/O).
 *
 * Row construction, PAN redaction, sequencing and _shre envelope extraction
 * for server-owned chat transcripts. The imperative shell (src/chat/persist.ts,
 * called from src/server.ts) does all reads/writes; everything here is
 * deterministic data-in/data-out.
 */

export type ChatSurface = 'aros-chat' | 'concierge' | 'start-chat' | 'api' | 'unknown';

/** Answer attribution pulled out of the /v1/chat response envelope. */
export interface ShreEnvelope {
  model: string | null;
  mode: string | null;
  agentId: string | null;
  toolsUsed: string[] | null;   // null = envelope carried none; [] = carried an empty list
  errorCode: string | null;
  connected: boolean | null;
  /** From `_shre.from_cache === true` OR the upstream `X-Cache: HIT` header.
   *  Absent ⇒ false (the column is NOT NULL DEFAULT false). */
  fromCache: boolean;
  /** shre-router trace id, if the envelope carried one. */
  traceId: string | null;
  /** Track C's typed zero: `_shre.dataSource.zero`. null = no data envelope. */
  zeroType: string | null;
  /** Track C's reply-gate reasons: `_shre.selfCheck`. `[]` = gate ran, clean.
   *  null = gate did not stamp this turn. These are NOT the same value. */
  selfCheck: string[] | null;
}

export interface TurnInput {
  /** Pre-minted by the shell BEFORE the handlers run (§4.3). Never resolved from the DB on the hot path. */
  conversationId: string;
  /** true when this turn created the conversation row (i.e. no valid client-supplied id). */
  isNewConversation: boolean;
  tenantId: string;
  userId: string;
  surface: ChatSurface;
  /** seq of the LAST persisted message in this conversation, or 0 if new. */
  lastSeq: number;
  userText: string;
  replyText: string;
  responseBody: unknown;         // the parsed /v1/chat JSON response
  httpStatus: number;
  latencyMs: number;
  clientTurnId: string | null;
  now: string;                   // ISO timestamp, injected — never Date.now() inside
  retentionDays: number;
}

/**
 * Row shapes. **snake_case, matching the SQL columns exactly** — these objects are
 * handed straight to `supabase.from(...).insert(row)`, so any camelCase here would be
 * a silent column-not-found at runtime. Do not "fix" the casing. Camel-casing happens
 * once, at the API boundary (§4.4 c/d), and nowhere else.
 */
export interface ConversationRow {
  id: string;                    // = TurnInput.conversationId (pre-minted, §4.3)
  tenant_id: string;
  user_id: string;
  surface: ChatSurface;
  title: string | null;
  message_count: number;         // lastSeq + 2
  started_at: string;            // ISO; = now on a new conversation
  last_message_at: string;       // ISO; = now
  expires_at: string;            // ISO; = now + retentionDays
  meta: Record<string, unknown>; // {} unless tenantClaimMismatch etc.
}

export interface MessageRow {
  conversation_id: string;
  tenant_id: string;
  user_id: string;
  seq: number;
  role: 'user' | 'assistant';
  content: string;               // already redacted, already length-capped
  model: string | null;
  mode: string | null;
  agent_id: string | null;
  tools_used: string[] | null;
  error_code: string | null;
  http_status: number | null;
  latency_ms: number | null;
  shre: unknown | null;          // redactJson(responseBody._shre)
  client_turn_id: string | null;
  created_at: string;            // ISO = TurnInput.now
  expires_at: string;            // ISO
}
// `id` is omitted from MessageRow on purpose: the column has a DEFAULT and the
// builder must not mint message ids (only the conversation id is pre-minted).

// PAN redaction is NOT declared here. Import the package's single primitive:
//   import { redactPan, PAN_REDACTION_MARKER } from './redact';
// `src/chat/redact.ts` is the one owner (spec: d-actionable-errors.md §Data
// contract 6a — Luhn-gated, with the shared fixture file
// src/chat/__fixtures__/pan-redaction.json). Track D normally lands it first;
// if it has not landed when you get here, CREATE it exactly as §6a specifies
// (redactPan + PAN_REDACTION_MARKER + the fixture file, nothing else) and D
// will import it. Do NOT declare a second PAN rule in this file — forking a
// shared safety primitive is a stop condition.

/** Recursively redact string leaves of a JSON value. Depth-capped at 8. */
export function redactJson(value: unknown): unknown;

/**
 * Pull model/mode/agentId/toolsUsed/errorCode + the four typed observability
 * fields out of _shre|metadata. Missing → null (fromCache missing → false).
 *
 * `responseHeaders` is passed separately because `from_cache` can arrive as an
 * `X-Cache: HIT` header rather than a body field. Headers in, no I/O — still pure.
 */
export function extractShre(
  responseBody: unknown,
  responseHeaders?: Record<string, string | string[] | undefined>,
): ShreEnvelope;

/**
 * How `surface` is derived. Declarative data + one total pure function — there is no
 * other rule anywhere in this track, and no other module may compute a surface.
 *
 * The label is DIAGNOSTIC ONLY. It is never read for authorization, never for tenancy,
 * never for RLS — exactly like `meta`. That is why a client-supplied value is
 * acceptable here and would not be acceptable for `tenant_id` (§4/§5).
 */
export const CHAT_SURFACES = ['aros-chat', 'concierge', 'start-chat', 'api', 'unknown'] as const;

/** Header fallbacks, tried in order, when the body carries no `surface`. Data, not code. */
export const SURFACE_HEADER_RULES: ReadonlyArray<{ header: string; equals: string; surface: ChatSurface }> = [
  // ConciergeChat is the only client that sends x-channel today
  // (apps/web/src/redesign/ConciergeChat.tsx:105). Verified on origin/main @ 9b4a693.
  { header: 'x-channel', equals: 'aros', surface: 'concierge' },
];

/**
 * resolveSurface — total, pure, never throws.
 *   1. `body.surface` if it is one of CHAT_SURFACES (added to the four clients in step 9).
 *   2. else the first matching SURFACE_HEADER_RULES entry (case-insensitive header lookup).
 *   3. else 'unknown'.
 * It NEVER guesses from a user-agent, a referer, or the shape of the body.
 * `headers` is passed in as a plain lowercase-keyed record so the function stays
 * framework-free and testable without an IncomingMessage.
 */
export function resolveSurface(
  body: Record<string, unknown> | null,
  headers: Record<string, string | undefined>,
): ChatSurface;

/** First line of the first user turn, trimmed to 80 chars. '' → null. */
export function conversationTitle(userText: string): string | null;

/** Pure builder: one turn → the conversation upsert + exactly two message rows. */
export function buildTurnRows(input: TurnInput): {
  conversation: ConversationRow;
  messages: [MessageRow, MessageRow];  // [user @ lastSeq+1, assistant @ lastSeq+2]
};

/** Bytes cap for a stored message body. Content beyond it is truncated with a marker. */
export const MAX_CONTENT_CHARS = 32_000;
```

Rules the implementation must honour:
- `redactPan` is **imported, never redeclared** (see the comment above). Its semantics — Luhn-gated so it does **not** mangle currency (`$1,234.56`), dates (`2026-07-24`), phone numbers (10 digits, fails the length test), or order ids shorter than 13 digits — are fixed by `d-actionable-errors.md` §Data contract 6a, and its fixtures live in `src/chat/__fixtures__/pan-redaction.json`. This brief's acceptance tests 1–3 assert against that file rather than against strings retyped here.
- `redactJson` applies `redactPan` to string leaves. It is the only place this track composes the primitive; it adds no digit rule of its own.
- `extractShre` returns `null` for anything the envelope did not carry. **Never substitute a default** — an invented model name is a defect, not a placeholder (house rule: no number without a verified data contract).
- **The four typed observability fields are a cross-track contract, not nice-to-haves (§15).**
  - `fromCache` — `true` iff `_shre.from_cache === true` **or** the upstream response carried `X-Cache: HIT`. Anything else is `false`. Verified upstream: `shre-router/src/chat-proxy.ts` sets `from_cache: true` and the `X-Cache` header; `shre-router/src/response-cache.ts` keys the cache with **no tenant component**, which is why track F must be able to exclude these rows.
  - `traceId` — whatever trace id the envelope carries, else `null`. Never mint one.
  - `zeroType` — `_shre.dataSource.zero` (track C's `ZeroType`), else `null`. Copy the string through verbatim; **do not validate it against a hard-coded list** — track C owns that vocabulary and A must not fork it.
  - `selfCheck` — `_shre.selfCheck` (track C's reply-gate reasons) when the key is present, **even when it is `[]`**; `null` only when the key is absent. `[]` means "the gate ran and found nothing"; `null` means "no gate ran". Collapsing them destroys track F's ability to tell a clean reply from an ungraded one.
  - All four survive `redactJson` unchanged (they are enum-ish strings and booleans; none can contain customer text). Assert that in the unit tests.
  - **Ordering:** track C lands before track A in the `/v1/chat` dispatch block (see Collision warnings), so `_shre.dataSource.zero` and `_shre.selfCheck` exist by the time this code runs. If a turn predates track C, both are `null` — that is a legitimate value, not an error, and track F handles it explicitly.
- `buildTurnRows` is total: given any `TurnInput` it returns rows, never throws.
- `now` and `retentionDays` are injected so tests are deterministic.
- `resolveSurface` is total and **never throws on hostile input** — a non-string, an object, or a 10 KB string all return `'unknown'`. It is the only place a surface is decided; if a second `surface` literal appears anywhere in `src/`, one of them is wrong.
- **No pure function in this module reads `crypto`, a clock, or `process.env`.** The conversation id is minted in the shell (`src/server.ts`, §4.3) and passed in as `TurnInput.conversationId` — that is what keeps `buildTurnRows` deterministic under test while still being the pre-minted, zero-I/O id on the wire.

### 4.3 New shell — `src/chat/persist.ts`

The **only** impure file added.

```ts
export async function persistTurn(input: PersistTurnInput): Promise<void>;
export async function loadConversationHistory(conversationId: string, tenantId: string, userId: string, limit: number): Promise<Array<{ role: 'user'|'assistant'; content: string }>>;
export async function purgeExpiredTranscripts(): Promise<void>;
```

#### The timing contract — ONE answer, stated once

**The conversation id is minted synchronously and locally, before the handlers run. No
database round-trip ever precedes the flush.**

```
crypto.randomUUID()        ← in-process, ~1 µs, zero I/O
        │
        ├─ injected into the buffered JSON as _shre.conversationId  (pure string edit)
        │
        └─ res.end()  ────────────────────────────────────────────►  bytes on the wire
                                                                        │
                                          persistTurn(...) starts here ─┘  (after end)
```

Why this and not the alternative: the only way to have a server-issued id on the wire
*and* a DB read before the flush is to block the reply on Supabase. Pre-minting removes
the choice entirely — the id is authoritative (server-generated, never client-trusted,
§4.4b) and costs nothing.

Consequences you must not re-litigate:
- There is **no 250 ms hold**, no `await` before `res.end()`, and no "flush without the
  field" fallback. The field is always present on a JSON reply.
- `chat_conversation.id` is supplied explicitly on INSERT (it is the pre-minted UUID);
  the column DEFAULT is only a safety net.
- On a *continuation* turn (client sent a syntactically valid `conversationId`), that id
  is echoed back and the pre-minted one is carried along unused — still zero I/O before
  the flush, because **ownership is validated after `res.end()`**, inside `persistTurn`.
  If ownership then fails, `persistTurn` stores the turn under the pre-minted id as a new
  conversation. The reply the user already received is unaffected: the id is diagnostic on
  the response and authoritative only on the row.

`persistTurn` contract:
- Wrapped in `try/catch` that logs and swallows, exactly like `auditLog` (`src/server.ts:1120-1142`). **A persistence failure must never fail a chat turn.**
- Runs entirely **after** `res.end()` has been called. It adds **0 ms** to time-to-first-byte. This is now literally true — see the timing contract above.
- Internally bounded: total work must complete or abort within **3 s**; use `AbortSignal.timeout(3000)` on the Supabase calls.
- **Ownership check (moved here from the hot path).** If the request carried a `conversationId`, load it and require `tenant_id` **and** `user_id` to match the session. On a mismatch or a miss, **do not** attach the turn: write it under the pre-minted id as a new conversation instead, and `auditLog({ action: 'chat.conversation_started' })`. A client-minted or stolen id can never attach a turn to someone else's thread.
- Reads `lastSeq` with `select seq … order by seq desc limit 1`, then inserts. On a `23505` unique violation, re-read `lastSeq` and retry **once**; on a second failure, log and give up.
- Uses `createSupabaseAdmin()` from `src/supabase.ts` (service role) — the tables have no authenticated write path.
- Calls `purgeExpiredTranscripts()` best-effort at most once per hour (module-level timestamp guard), per the `purge_expired_cart_drafts` pattern.

### 4.4 API surfaces

**(a) `/v1/chat` response — additive only.** The server issues the conversation id and returns it inside the existing `_shre` object:

```jsonc
{
  "content": "…",
  "_shre": { "model": "aros-store-data", "mode": "aros-sales-direct", "conversationId": "b3f1…-uuid" }
}
```

For the proxied path the AROS server injects `_shre.conversationId` into the response JSON it already buffers. **If the response is not JSON or cannot be parsed within the buffer cap, pass the bytes through untouched and skip persistence for that turn.** Never corrupt a reply to add a field.

The injected id is the **pre-minted** one from §4.3 (or the client's, when the client sent a syntactically valid `conversationId`). Injection is a pure string/JSON edit over an already-buffered body: **no I/O, no await, no hold.**

**(b) `/v1/chat` request — additive only.** The client may send:
```jsonc
{ "agentId": "aros-agent", "surface": "concierge", "conversationId": "b3f1…-uuid", "clientTurnId": "…", "messages": [ … ] }
```
`surface` is one of the five values in `CHAT_SURFACES` (§4.2); anything else, or absent, resolves through `resolveSurface` to a header rule or `'unknown'`. It is diagnostic only and is never read for authorization.

`conversationId` is echoed back on the reply if it is a syntactically valid UUID, and is honoured **for storage** only if the row exists and its `(tenant_id, user_id)` match the authenticated session — a check that runs **after** the flush (§4.3). If it fails, the turn is stored under a fresh server-minted conversation. A client-minted id can never attach a turn to someone else's thread.

**(c) `GET /api/chat/conversations?limit=50` — authenticated, own history.**
```jsonc
{ "conversations": [ { "id": "uuid", "surface": "aros-chat", "title": "Show today's sales",
                       "messageCount": 12, "startedAt": "…", "lastMessageAt": "…" } ],
  "fetchedAt": "2026-07-24T…Z" }
```

**(d) `GET /api/chat/conversations/:id` — authenticated, own thread.**
```jsonc
{ "conversation": { "id": "uuid", "surface": "aros-chat", "title": "…", "startedAt": "…", "lastMessageAt": "…" },
  "messages": [ { "seq": 1, "role": "user", "content": "…", "createdAt": "…" },
                { "seq": 2, "role": "assistant", "content": "…", "model": "aros-store-data",
                  "mode": "aros-sales-direct", "agentId": null, "toolsUsed": ["mib_sales_today"],
                  "errorCode": null, "latencyMs": 812, "createdAt": "…" } ] }
```
Every field that the envelope did not carry is `null` — the client must render "—", never a guess.

**(e) `DELETE /api/chat/conversations/:id` — authenticated, own thread only.** Hard delete (cascade removes messages). Writes `auditLog({ action: 'chat.transcript_deleted' })`. Returns `204`.

**(f) `GET /api/platform/conversations?tenantId=&from=&to=&failedOnly=&limit=` — founder console, cross-tenant, read-only.** Served through the existing `handlePlatformConsole` gate (§12), which already `auditLog`s every access.
```jsonc
{ "conversations": [ { "id": "uuid", "tenantId": "uuid", "tenantName": "…", "userId": "uuid",
                       "surface": "concierge", "messageCount": 8, "lastMessageAt": "…",
                       "failures": 1, "models": ["aros-store-data"] } ],
  "totals": { "conversations": 143, "messages": 1102, "failedReplies": 37 } }
```
and `GET /api/platform/conversations/:id` returns the same shape as (d).

**(g) Client props.** No new React props. **`ConciergeChat` — and only `ConciergeChat`** — gains one `useRef<string | null>(null)` holding the server-issued `conversationId`, read from `data?._shre?.conversationId` and echoed on the next request. (`ArosChat` was listed here in the first draft; it is unmounted dead code — see the §9 correction. This track does not touch it.)

---

## Implementation steps

### Sequencing — read this before you start

Two of the eleven steps cannot be run by Codex at all: **step 2** needs the Supabase
SQL console and **step 3's *run*** needs a deploy plus an hour of real traffic. Both are
labelled **[FOUNDER/OPERATOR]** below. Earlier drafts of this brief declared
"steps 1 → 2 → 3 are strictly sequential", which parked the whole track behind an
operator. That is wrong and is corrected here:

| Lane | Steps | Who | Gate |
|---|---|---|---|
| **Codex, unblocked, land now** | 1 (migration file), 4 (pure core + its tests), 5 (shell), 3-code (canary behind `CHAT_PERSIST_CANARY`) | Codex | none |
| **Codex, land dark** | 6 (seam wiring), 7, 8, 9, 10, 11 | Codex | needs 4 + 5 in the tree. Ships with `CHAT_PERSIST` **unset** ⇒ every added path is a no-op, so no DB and no deploy is required to merge. |
| **Operator only** | 2 (apply migration), 3-run (canary on the deployed surface), the flip of `CHAT_PERSIST=1` | Founder / operator | 2 before any `CHAT_PERSIST=1`; 3-run before persisting a surface whose auth resolution is still UNVERIFIED (§9) |

The **only** thing steps 2 and 3 gate is **turning the feature on**. They gate no code.
A merged PR containing steps 1 and 3-code through 11 with the flag off changes runtime
behaviour by nothing at all — that is the whole reason the flag exists.

Acceptance tests split the same way: A, C, D and (the unit half of) G are Codex-runnable;
B, E, F need the migration applied and the flag on, so they are operator-run and their
results belong in the PR body, not in Codex's gate.

Within each lane, steps are ordered. Parallelism is called out per step.

Before editing `src/server.ts` in any step: **re-read the target function by name** (`grep -n "function handleArosSalesChat" src/server.ts`). The file is 7,214 lines and co-edited — line numbers in this brief will drift. Never edit "line N".

---

**Step 0 — Read § Bind to the AI activity spine. (no code)** *(Codex-executable, mandatory)*
It is above the migration because it is a **stop condition**, not a collision note. Confirm in the PR body that both tables carry `tenant_id` + `user_id` NOT NULL and FK-enforced (the spine's actor stamp), that the storage shape is append-only per-message rows (Centrix's blob + 30-minute TTL is adopted for attribution only, rejected for persistence), and that no second attribution store is being created. If any of those three is not true of what you are about to write, **stop**.

**Step 1 — Write the migration. (no code depends on it yet)** *(Codex-executable)*
File: **create** `supabase/migrations/20260724_chat_transcripts.sql` with the SQL in §4.1 verbatim.
Verify: `pnpm check:migrations` exits 0 and prints `✓ Migration safety check passed (N migrations scanned)` where **N is exactly one more than the count on `origin/main`**. Record the before/after numbers in the PR body; do **not** assert a literal count — tracks E, F, G and H each add a migration too, so any hard-coded number is wrong for whoever lands second. Get the baseline with `ls supabase/migrations/*.sql | wc -l` before you add the file.
Do **not** write any TypeScript that references the tables yet.

**Step 2 — [FOUNDER/OPERATOR] Apply the migration by hand, then verify it landed.** *(Codex cannot do this — no Supabase console. Hand off the artifact below and continue with steps 4, 5 and 6.)*
There is no migration runner (§11). Paste the file into the Supabase SQL editor for the AROS project and run it.

**Handoff artifact Codex must produce for this step** (and nothing more): the migration file from step 1, plus the two verification queries below, pasted verbatim into the PR description under a heading `OPERATOR: apply before enabling CHAT_PERSIST`. Codex does not wait on the result — steps 4, 5 and 6 land with the flag off (§ Sequencing).
Verify with a read-only query:
```sql
select table_name from information_schema.tables
 where table_schema='public' and table_name in ('chat_conversation','chat_message');
select tablename, policyname, cmd from pg_policies
 where schemaname='public' and tablename like 'chat_%';
select relname, relrowsecurity from pg_class where relname in ('chat_conversation','chat_message');
```
Expected: 2 tables, `relrowsecurity = true` for both, exactly 2 policies both `cmd = SELECT`.
**Nothing may set `CHAT_PERSIST=1` before this step is verified.** Writes are flag-gated, so unapplied migration + flag off = today's behaviour exactly.

**Step 3 — Log-only canary at the `/v1/chat` seam. No writes.** *(Codex writes the code; **[FOUNDER/OPERATOR]** runs it on the deployed surface and reports the result.)*
File: `src/server.ts`, inside the `pathname === '/v1/chat'` block (currently `:6783`).
Add, gated by `process.env.CHAT_PERSIST_CANARY === '1'`, a fire-and-forget call **after** the handler returns that resolves `authenticateRequest(req)` and `console.log`s one line prefixed `[chat-canary]`: `{ surface, authResolved: boolean, tenantFromAuth, tenantFromBody, tenantMatch }`. No `chat_*` table is touched.
This exists to settle the **UNVERIFIED** claim in §9: does `authenticateRequest` actually resolve for each surface's requests in production?

**Split of duties:**
- *Codex (unblocked, do this now):* land the canary code behind its flag. It is inert with `CHAT_PERSIST_CANARY` unset, so it merges without an operator.
- *Operator (deploy-gated):* enable the flag, let it run for at least an hour of real traffic, then read the logs. **Handoff artifact = the exact grep:**
  ```bash
  # on aros-vps, against the platform process log
  pm2 logs aros-platform --lines 5000 --nostream \
    | grep '\[chat-canary\]' \
    | awk '{print}' | sort | uniq -c | sort -rn
  ```
  Report, per `surface`, the count with `authResolved:true` vs `authResolved:false`, and the count with `tenantMatch:false`.

**If `authResolved` is false for a surface you intend to persist, STOP** and go to § Stop conditions (Q2) — the whole persistence design assumes an identity is available for that surface.
**This step gates only the flip of `CHAT_PERSIST` to `1`. It does not gate landing any code.**

**Step 4 — The pure core. (parallel with step 3; blocked by nothing.)**
File: **create** `src/chat/transcript.ts` with the exports in §4.2. Pure only.
File: **create** `src/__tests__/chat-transcript.test.ts` (see Acceptance tests).
Verify: `pnpm exec vitest run src/__tests__/chat-transcript.test.ts` — all green.
This step touches no existing file and can be reviewed on its own.

**Step 5 — The shell. (depends on 4. Does NOT depend on step 2 — nothing calls it yet, so an unapplied migration cannot break it.)**
File: **create** `src/chat/persist.ts` with the exports in §4.3.
Nothing calls it yet. Verify: `pnpm typecheck`.

**Step 6 — Wire the seam. (depends on 4 and 5. Lands DARK: with `CHAT_PERSIST` unset every added path is a no-op, so it does NOT depend on step 2 or on step 3's run.)**
File: `src/server.ts`, the `pathname === '/v1/chat'` block only.

> **SEQUENCING — read before you paste the snippet below.** This track is **LAST**
> into the `/v1/chat` dispatch block. Declared package order for that block is
> **C → D → I → A** (see §Collision warnings → Package file-ownership register).
> By the time you get here the block will have **five** handler lines, not four —
> track D inserts `handleArosConnectorHealthChat(req, res, body, chatDeps)`
> between the ping and automation lines — and the handlers' replies will be going
> through track C's `arosChatJson()`. **`grep -n "handleAros" src/server.ts` and
> wrap what is actually there.** The snippet below is illustrative of the shim
> pattern, not a literal target. Wrapping is mechanical (`res` → `capture.res` on
> each line, plus `finish()`), so a fifth or sixth handler costs you nothing —
> but pasting the four-handler version over the file **silently deletes D's
> handler**, and nothing in CI would catch it.

Add a response-capture shim (a small local helper next to the block, or a second export from `src/chat/persist.ts` — your call, but keep it under 40 lines). It wraps `res.write`/`res.end` to buffer up to 512 KB, so it works identically for the local handlers (which call `json(res, …)`, `src/server.ts:901`, or `arosChatJson(...)` once track C has landed) and for `proxyRequest` (which pipes upstream bytes). Then:

```
if (pathname === '/v1/chat' && method === 'POST') {
  const body = await parseJsonBody(req);
  const started = Date.now();
  // Pre-minted, in-process, zero I/O (§4.3). Reused as the row id if this turn
  // starts a new conversation; carried along unused if the client sent a valid one.
  const mintedConversationId = crypto.randomUUID();
  // UUID_RE already exists at src/server.ts:3789 — reuse it, do not add a second regex.
  const echoConversationId = typeof body?.conversationId === 'string' && UUID_RE.test(body.conversationId)
    ? body.conversationId : mintedConversationId;
  // captureJsonResponse injects _shre.conversationId = echoConversationId into the
  // buffered JSON. Pure string work — it NEVER awaits and NEVER holds the flush.
  const capture = captureJsonResponse(res, echoConversationId);  // no-op unless CHAT_PERSIST === '1'
  const finish = () => { void afterChatTurn(req, body, capture, started, mintedConversationId, echoConversationId); };

  if (await handleArosHealthPing(req, capture.res, body))       { finish(); return; }
  // ← track D's handleArosConnectorHealthChat(req, capture.res, body, chatDeps)
  //   sits HERE once D has landed. Keep it. Do not regenerate this list.
  if (await handleArosAutomationChat(req, capture.res, body))   { finish(); return; }
  if (await handleArosStoreDataChat(req, capture.res, body))    { finish(); return; }
  if (await handleArosSalesChat(req, capture.res, body))        { finish(); return; }
  await proxyRequest(req, capture.res, SHRE_ROUTER_URL, body);
  finish();
  return;
}
```

`afterChatTurn` is the only new impure entry point. It must:
1. Return immediately (do not `await`) — it runs after the response is written.
2. Bail unless `process.env.CHAT_PERSIST === '1'`.
3. Resolve `const auth = await authenticateRequest(req)`. **If `auth` is null, drop the turn** and return (see Non-goals: anonymous surfaces are out of scope for v1).
4. Use `auth.tenantId` and `auth.userId` — **never** `arosChatTenant(req, body)`. If `arosChatTenant(req, body)` is a UUID and differs from `auth.tenantId`, set `meta.tenantClaimMismatch = true` on the conversation and emit `auditLog({ tenantId: auth.tenantId, userId: auth.userId, action: 'chat.tenant_claim_mismatch', resource: claimedTenant })`.
5. Extract the user turn with the existing `chatLatestText(body)` (`src/server.ts:4156`) and the reply with the same precedence as `apps/web/src/lib/chatReply.ts:9` (`response` → `message` → `content`, object-or-string).
6. Resolve `surface` with `resolveSurface(body, req.headers)` (§4.2). Never guess it.
7. Resolve the conversation, **all of it after the flush**: if `echoConversationId !== mintedConversationId` (the client supplied one) **and** a row exists with matching `tenant_id` **and** `user_id`, attach to it; otherwise insert a new `chat_conversation` **using `mintedConversationId` as its `id`** and `auditLog({ action: 'chat.conversation_started' })`.
8. Call `persistTurn(...)`.

**Explicitly NOT in `afterChatTurn`: injecting the id.** Injection already happened, synchronously, inside `captureJsonResponse` using `echoConversationId` — a value that exists before the first handler runs. There is **no hold, no 250 ms cap, and no await between the handler returning and `res.end()`** (§4.3). If you find yourself writing a timeout around the flush, you have reintroduced the contradiction this brief was corrected to remove.

Verify: `pnpm typecheck`, then the E2E in Acceptance tests.

**Step 7 — Authenticated read + delete surfaces. (depends on 6.)**
File: `src/server.ts`. Add three routes next to the other `/api/…` routes (the region around `src/server.ts:7076`):
- `GET /api/chat/conversations` → §4.4(c)
- `GET /api/chat/conversations/:id` → §4.4(d)
- `DELETE /api/chat/conversations/:id` → §4.4(e)

All three: `const auth = await authenticateRequest(req); if (!auth) return json(res, 401, { error: 'Authentication required' });` then query **filtered by both `auth.tenantId` and `auth.userId`** even though they use the service role. Belt and braces — the service role bypasses RLS.

**Step 8 — Founder monitoring surface. (parallel with step 7.)**
File: `src/server.ts`. Extend the existing regex at `src/server.ts:7076`:
```ts
  const platformMatch = pathname.match(/^\/api\/platform\/(overview|tenants|audit|conversations)(?:\/([0-9a-f-]+))?$/);
```
and add a `if (section === 'conversations')` branch inside `handlePlatformConsole` (`src/server.ts:3398`) implementing §4.4(f). The existing `requirePlatformAdmin` gate and the `auditLog` at `src/server.ts:3402` cover it automatically.
File: `apps/web/src/pages/PlatformConsole.tsx` — add a "Conversations" section rendering the list, using the existing `api<T>(path)` helper at `:49`. Mobile-first, **zero horizontal page scroll at 320–1440px** (put the table in an `overflow-x:auto` container, never the page body).
**Do not add a workspace-scoped admin page** under `apps/web/src/redesign/pages/admin/` in this track — see Non-goals.

**Step 9 — Client conversation-id echo. (parallel with 7/8, depends on 6.)**
~~File: `apps/web/src/aros-ai/ArosChat.tsx` — add `const conversationIdRef`…~~ **REMOVED (2026-07-24).** `ArosChat.tsx` is unmounted dead code (§9 correction) — editing it ships an untestable diff to a component no user can reach. **This track touches exactly ONE client file.**

File: `apps/web/src/redesign/ConciergeChat.tsx` — **the only client edit in this track.** Add `const conversationIdRef = useRef<string | null>(null);`, include `surface: 'concierge'` **and** `...(conversationIdRef.current ? { conversationId: conversationIdRef.current } : {})` in the request body around `:111-118` (the `surface` literal is what `resolveSurface` reads — §4.2; without it every row would fall back to the `x-channel: aros` header rule, which is correct but fragile), and set it from `data?._shre?.conversationId` in the envelope read around `:127-133`. The shell's **New chat** button (`AppShell.tsx` `newChat`, which remounts via `key={chatKey}` at `:240`) resets the ref for free — a fresh mount starts with `null`; additionally fire a best-effort `DELETE /api/chat/conversations/:id` from an `onNewChat` callback so "New chat" no longer lies. **Do not remove the full-history resend in this step** (see Non-goals).
**Do not** touch the composer, the voice hook, `ChatMessageRenderer`, or the canvas plumbing — those belong to concurrent tracks (see §Collision warnings).
Verify: `pnpm typecheck && pnpm lint`.

**Step 10 — Server-side history replay, second flag, default OFF. (depends on 6.)**
File: `src/server.ts`, in the `/v1/chat` block, before the handlers run.
When `process.env.CHAT_SERVER_HISTORY === '1'` **and** the request carries a valid own-`conversationId`, replace `body.messages` with `[...(await loadConversationHistory(convId, auth.tenantId, auth.userId, 20)), { role: 'user', content: chatLatestText(body) }]` — i.e. the server rebuilds history from its own rows and keeps only the client's newest turn. This is the "client sends only the new turn" endgame.
It is **off by default** because it changes what the model sees and therefore answer quality. Ship it dark; flip it only after a track-F comparison run.
Note: this requires `auth` at the *top* of the block (an extra `authenticateRequest` on the hot path). Gate that call on the flag so the default path pays nothing.

**Step 11 — Track F feed. (parallel with 7–10, depends on 6.)**
File: **create** `scripts/chat-eval/from-transcripts.mjs` — a new imperative shell that pulls `chat_message` rows (via `GET /api/platform/conversations`, or Supabase service role when run on the VPS) and feeds `scoreReply` / `aggregate` / `renderReport` imported from the existing pure `scripts/chat-eval/core.mjs`.
**Do not modify `scripts/chat-eval/run.mjs` or `core.mjs`** — track F owns them (see Collision warnings).

---

## Acceptance tests

### A. Pure-function unit tests — `src/__tests__/chat-transcript.test.ts`

Run: `pnpm exec vitest run src/__tests__/chat-transcript.test.ts`

Must cover, with fixtures:

1. **`redactPan` — positives, from the shared fixture file.** Load `src/chat/__fixtures__/pan-redaction.json` (owner: `src/chat/redact.ts`, spec in `d-actionable-errors.md` §Data contract 6a) and assert every entry in `redacted` comes back containing `PAN_REDACTION_MARKER` with none of its original digits. **Do not retype fixtures into this file** — one list, three consumers (this test, D's `redact.test.ts`, F's `transcript-core.test.mjs`); that shared list is what makes drift a test failure instead of a leak.
2. **`redactPan` — negatives (no false positives).** Every entry in the fixture file's `unchanged` list must come back **byte-identical** — including `'Total Sales: $1,234,567.89'`, `'business date 2026-07-24'`, `'call 5551234567'`, `'order 9876543210'` (10 digits), `'sku 123456789012'` (12 digits), and `'2026072420260724'` (16 digits, Luhn-invalid).
3. **`redactPan` is idempotent** — `redactPan(redactPan(x)) === redactPan(x)` for every entry in both lists.
4. **`redactJson`** redacts string leaves inside nested objects/arrays and stops at depth 8 without throwing on a cyclic-ish deep structure.
5. **`extractShre` — AROS-local shape.** Input `{ content:'online', _shre:{ model:'aros-health', toolsUsed:[], mode:'aros-health-direct', connected:true } }` → `{ model:'aros-health', mode:'aros-health-direct', agentId:null, toolsUsed:[], errorCode:null, connected:true }`. **`agentId` must be `null`, not `'main'` or `'aros-agent'`.**
6. **`extractShre` — error shape.** `{ content:'…', _shre:{ model:'aros-store-data', toolsUsed:['mib_sales_today'], mode:'aros-sales-direct', error:'sales_unavailable' } }` → `errorCode === 'sales_unavailable'`.
7. **`extractShre` — router shape.** `{ _shre:{ decisionTrace:{ agentId:'storepulse' }, toolsUsed:['x'], model:'shre-70b' } }` → `agentId === 'storepulse'`.
8. **`extractShre` — absent envelope.** `{ content:'hi' }` → every field `null` **except `fromCache`, which is `false`** (the column is `NOT NULL DEFAULT false`; `null` is not a legal value for it). **No other invented defaults.**
8a. **`extractShre` — the four typed observability fields (track F's contract, §15.1).**
   - `{ _shre:{ from_cache:true } }` → `fromCache === true`; `extractShre({}, { 'x-cache': 'HIT' })` → `fromCache === true`; `extractShre({}, { 'x-cache': 'MISS' })` → `fromCache === false`.
   - `{ _shre:{ dataSource:{ zero:'mapper_drift' } } }` → `zeroType === 'mapper_drift'`. A `zero` value this brief has never heard of (e.g. `'future_type'`) must **also** come through verbatim — assert that explicitly. Track C owns the vocabulary; A must not validate or fork it.
   - `{ _shre:{ selfCheck: [] } }` → `selfCheck` deep-equals `[]`, **not** `null`. `{ _shre:{} }` → `selfCheck === null`. *This distinction is the whole point of the field — assert both directions in the same test.*
   - `{ _shre:{ selfCheck:['error-leak:econnrefused'] } }` → `selfCheck` deep-equals `['error-leak:econnrefused']`.
   - **Redaction parity:** `redactJson` applied to an envelope carrying all four leaves every one of them byte-identical (none can contain customer text, and mangling them would break track F's grading silently rather than loudly).
9. **`buildTurnRows` sequencing.** `lastSeq: 0` → messages at `seq` 1 and 2, roles `user` then `assistant`. `lastSeq: 7` → 8 and 9.
10. **`buildTurnRows` redacts before building** — a PAN in `userText` or `replyText` never appears in the returned rows.
11. **`buildTurnRows` expiry** — `retentionDays: 90`, `now: '2026-07-24T00:00:00.000Z'` → `expires_at === '2026-10-22T00:00:00.000Z'` on both the conversation and both messages.
12. **`buildTurnRows` truncation** — a 40,000-char reply is truncated to `MAX_CONTENT_CHARS` with a visible marker, and does not throw.
13. **`buildTurnRows` never throws** on `{ userText:'', replyText:'', responseBody: null, clientTurnId: null }`.
14. **`conversationTitle`** — `''` → `null`; a 200-char first line → 80 chars.
15. **`resolveSurface` — declared value wins.** `({ surface: 'concierge' }, { 'x-channel': 'aros' })` → `'concierge'`.
16. **`resolveSurface` — header fallback.** `({}, { 'x-channel': 'aros' })` → `'concierge'`.
17. **`resolveSurface` — unknown fallback.** `({}, {})` → `'unknown'`; `({ surface: 'sql-injection' }, {})` → `'unknown'` (a value outside `CHAT_SURFACES` is never trusted, never stored, and never throws); `(null, {})` → `'unknown'`.
18. **`resolveSurface` is total** — every returned value is a member of `CHAT_SURFACES`, asserted over a fuzz list including `undefined`, `123`, `{}`, `[]` and a 10 KB string.

*(Tests 1–18 are Codex-runnable with no DB, no network and no deploy. They are this track's merge gate.)*

### B. RLS negative tests — `scripts/chat-eval/rls-check.sql` (run manually against a NON-production Supabase, or prod read-only after seeding two throwaway rows)

Run: paste into the Supabase SQL editor. **Every query must return 0 rows.**

```sql
-- Setup (service role): two users in two tenants, one conversation each.
-- Then, impersonating user A via a Supabase anon-key session:

-- (1) cross-TENANT read must return zero rows
select count(*) from public.chat_conversation where tenant_id = '<tenant-B-uuid>';   -- expect 0
select count(*) from public.chat_message      where tenant_id = '<tenant-B-uuid>';   -- expect 0

-- (2) cross-USER read INSIDE the same tenant must return zero rows
--     (this is the test the member-read precedent would FAIL)
select count(*) from public.chat_conversation
 where tenant_id = '<tenant-A-uuid>' and user_id = '<user-A2-uuid>';                 -- expect 0

-- (3) a workspace OWNER must not see a member's private thread
--     (run as the tenant-A owner, querying the member's conversation)      -- expect 0

-- (4) no authenticated write path
insert into public.chat_message (conversation_id, tenant_id, user_id, seq, role, content, expires_at)
values ('<own-conversation>', '<tenant-A-uuid>', '<user-A-uuid>', 99, 'assistant', 'forged', now() + interval '1 day');
-- expect: ERROR  new row violates row-level security policy

delete from public.chat_message where conversation_id = '<own-conversation>';
-- expect: 0 rows affected (no DELETE policy)

-- (5) anon key sees nothing at all
--     (run with the anon key, no session)                                  -- expect 0 / permission denied
```

Also assert positively: as user A, `select count(*) from public.chat_message where conversation_id = '<own-conversation>'` returns the expected count. A test that only proves "everything is empty" proves nothing.

### C. Migration lint

Run: `pnpm check:migrations`
Expected: `✓ Migration safety check passed (…)`. This is the machine-enforced "RLS from the first migration" gate (`scripts/check-migration-safety.mjs:31-40`).

### D. Typecheck / lint

Run: `pnpm typecheck && pnpm lint`

### E. Live E2E — the check that proves it in the real flow — **[FOUNDER/OPERATOR-EXECUTED]**

This is the only test that proves the keystone. Run against a deployment with `CHAT_PERSIST=1`.

**Codex does not run this test and does not attempt to obtain a credential for it.**
Every step below needs an interactive production sign-in or a bearer token minted from
one. The rules, which are mission-wide:

- **No login, by anyone but the founder, in a browser they are already using.** The
  stored eval credential returns 401 as of `2026-07-24T00:17:28Z`, `src/server.ts:1176-1189`
  escalates a lockout keyed `email:ip`, and the founder cannot currently sign in to
  recover from one. Do **not** script `POST /api/login`, do **not** reuse
  `~/.shre/secrets/chat-eval.env`, do **not** retry a failed sign-in.
- **`$ACCESS_TOKEN` / `$OTHER_USER_TOKEN` come from the founder** — copied out of their
  own already-authenticated browser session (devtools → Application → the Supabase
  session) and pasted into the shell for the run. They are never minted by an executor,
  never committed, and expire on their own.
- Codex's deliverable is the handoff: this exact script, plus the expected values, in the
  PR body. Sections A–D and G are Codex's merge gate and none of them authenticate.

> **REWRITTEN 2026-07-24.** The original step 1 read *"open the AROS chat widget"* and step 4 expected `surface "aros-chat"`. **That test was unrunnable** — `ArosChat.tsx` is unmounted dead code (§9 correction). The live in-app chat is `ConciergeChat`, mounted by `AppShell.tsx:240` and reachable at **`/chat`** (`App.tsx:255` routes every onboarded authenticated path to `<AppShell />`). Expected surface is therefore **`concierge`**, not `aros-chat`.

```bash
# 1. Sign in in a browser at https://app.aros.live and go to /chat — the
#    chat-first shell (AppShell -> ConciergeChat, AppShell.tsx:240). This is the
#    only in-app chat a signed-in user can reach.
#    Ask exactly: "What were today's sales?"   (routes to handleArosSalesChat — an
#    AROS-LOCAL handler that never reaches shre-router; this is the case a
#    proxy-level hook would miss.)
#
# 2. In the browser devtools Network tab, confirm the /v1/chat response body
#    now carries _shre.conversationId (a UUID).
#
# 3. Ask a SECOND question in the same chat pane — use exactly
#    "What were yesterday's sales?" so it ALSO routes to handleArosSalesChat and
#    both assistant rows carry the same model/mode. Confirm the request body now
#    carries "conversationId" equal to the id from step 2.
#
# 4. As the SAME signed-in user, fetch your own history:
curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
     -H "x-aros-tenant-id: $TENANT_ID" \
     https://app.aros.live/api/chat/conversations | jq
#    Expect: one conversation, messageCount 4, surface "concierge".
#    (NOT "aros-chat" — that surface value is unreachable, see the §9 correction.)

curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
     https://app.aros.live/api/chat/conversations/$CONV_ID | jq '.messages[] | {seq, role, model, mode, errorCode}'
#    Expect: seq 1..4, roles user/assistant/user/assistant,
#            model "aros-store-data", mode "aros-sales-direct" on the assistant rows.
#            NOT null model — handleArosSalesChat (src/server.ts:4232) always sets
#            _shre.model on both its success and its error replies.
#
# 5. Reload the page. Confirm the transcript is still retrievable from the API.
#    (ConciergeChat holds transcript state in memory only — src/redesign/
#    ConciergeChat.tsx:54 — so after a reload the API IS the only record. That is
#    the point of this track.)
#
# 6. NEGATIVE — another user's thread:
curl -s -o /dev/null -w '%{http_code}\n' \
     -H "Authorization: Bearer $OTHER_USER_TOKEN" \
     https://app.aros.live/api/chat/conversations/$CONV_ID
#    Expect: 404 (not 403 — do not confirm the id exists).
#
# 7. FAILURE CAPTURE — ask a store-data question in a workspace with NO
#    connected RapidRMS store. The reply is HTTP 200 with
#    _shre.connected=false. Confirm the stored assistant row has
#    connected=false in `shre` and errorCode null (it is a "no data"
#    answer, not an error) — and that a workspace whose connector call
#    throws stores errorCode 'sales_unavailable'.
#
# 8. AUDIT — confirm exactly one audit_log row with action
#    'chat.conversation_started' for the new conversation, and none with
#    'chat.tenant_claim_mismatch'.
```

### F. Latency budget check — **[FOUNDER/OPERATOR]**, needs a deploy with the flag on

> **CORRECTED 2026-07-24.** The earlier version of this test was **guaranteed to fail against a correct implementation.** It sent 50 requests with no `conversationId`, so under the old (contradictory) design every one of them minted a conversation with a Supabase insert *before* the flush — tens of ms each, not <5 ms. The design is now pre-minted-id (§4.3): **no DB call ever precedes `res.end()`, on a first turn or any other.** The single budget below is therefore honest for both cases, and the test exercises both.

**Same credential rule as section E: the founder runs this from their own live browser
session's token. Codex does not sign in, does not script `POST /api/login`, and does not
use the stored eval credential** (`~/.shre/secrets/chat-eval.env` — 401 since
`2026-07-24T00:17:28Z`, lockout live). Prefer a **non-production** base with
`CHAT_PERSIST=1` if one is available; `https://app.aros.live` below is the fallback and
costs ~202 requests on the founder's own workspace. `say online` is the health-ping
handler, so no model lane is touched and no other tenant is involved — keep it that way:
this test is single-workspace by construction, never a fleet run.

Named budget: **server-side persistence adds < 5 ms p95 to `/v1/chat` time-to-first-byte — on a first turn and on a continuation turn alike.** There is no second, looser first-turn budget, because there is no pre-flush work to pay for. There is no 250 ms cap anywhere; if you find one in the implementation, §4.3 was not followed.

Run, with `CHAT_PERSIST=0` then `CHAT_PERSIST=1`, 50 iterations each, **twice** — once as new conversations, once as one continuing thread:

```bash
# (F1) NEW CONVERSATION EVERY TURN — the case the old test accidentally made unpassable.
for i in $(seq 1 50); do
  curl -s -o /dev/null -w '%{time_starttransfer}\n' -X POST https://app.aros.live/v1/chat \
    -H 'Content-Type: application/json' -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H 'x-channel: aros' -H "x-aros-tenant-id: $TENANT_ID" \
    -d '{"agentId":"aros-agent","surface":"api","messages":[{"role":"user","content":"say online"}],"stream":false}'
done | sort -n | awk '{a[NR]=$1} END {print "F1 p50",a[int(NR*0.5)],"p95",a[int(NR*0.95)]}'

# (F2) ONE CONTINUING THREAD — capture the id from the first reply, then reuse it.
CONV=$(curl -s -X POST https://app.aros.live/v1/chat \
  -H 'Content-Type: application/json' -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'x-channel: aros' -H "x-aros-tenant-id: $TENANT_ID" \
  -d '{"agentId":"aros-agent","surface":"api","messages":[{"role":"user","content":"say online"}],"stream":false}' \
  | jq -r '._shre.conversationId')
test -n "$CONV" && test "$CONV" != null || { echo "FAIL: no _shre.conversationId on the reply"; exit 1; }
for i in $(seq 1 50); do
  curl -s -o /dev/null -w '%{time_starttransfer}\n' -X POST https://app.aros.live/v1/chat \
    -H 'Content-Type: application/json' -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H 'x-channel: aros' -H "x-aros-tenant-id: $TENANT_ID" \
    -d "{\"agentId\":\"aros-agent\",\"surface\":\"api\",\"conversationId\":\"$CONV\",\"messages\":[{\"role\":\"user\",\"content\":\"say online\"}],\"stream\":false}"
done | sort -n | awk '{a[NR]=$1} END {print "F2 p50",a[int(NR*0.5)],"p95",a[int(NR*0.95)]}'
```

(`say online` routes to `handleArosHealthPing`, `src/server.ts:4209` — the cheapest handler, so the delta is almost entirely persistence.) Compare each p95 against the same run with `CHAT_PERSIST=0`.

**Pass criteria — both must hold:**
1. `F1` delta < 5 ms p95 **and** `F2` delta < 5 ms p95.
2. The `CONV` capture in F2 is non-empty — i.e. the id is on the wire on the *first* reply, with no hold. (This is the assertion that the pre-mint actually happened; a lazily-resolved id would show up as an empty or absent field, not as latency.)

**If either delta exceeds 5 ms, something is awaiting before the flush — fix it before merging; do not widen the budget.**

### G. Track F smoke

Run: `node scripts/chat-eval/from-transcripts.mjs --tenant $TENANT_ID --since 7d --out /tmp/report.md`
Expected: a report scored by the untouched `core.mjs`, with a non-zero row count sourced from `chat_message` and **no** Supabase admin magiclink minting anywhere in the run.

---

## Non-goals

This track must **not**:

1. **Change `/v1/chat` authentication semantics.** Today the route does not call `authenticateRequest` before the handlers. Persistence resolves auth *after* the reply, purely to attribute a row. Making the route require auth would break anonymous/demo chat and belongs to a separate, founder-approved track.
2. **Persist anonymous or public traffic.** `ChatWidget` (`/v1/chat/public`, no auth) and `StartChat` demo mode (`demo-<uuid>`, no auth) are **out of scope for v1**. Their turns are dropped, not written under a null user. Rationale: a transcript table whose RLS is `user_id = auth.uid()` has no correct home for a row with no user, and a "demo scope" would be a second, unRLS'd tenancy concept. Revisit as its own track with its own retention.
3. **Remove `ConciergeChat`'s full-transcript resend** (`apps/web/src/redesign/ConciergeChat.tsx:115`). That changes what the model sees and therefore answer quality. Step 10 ships the server-side replacement dark; flipping it is a separate decision backed by a track-F comparison.
4. **Any edit at all to `apps/web/src/aros-ai/ArosChat.tsx`**, including its localStorage cache (`STORAGE_KEY` at `:15`). It is unmounted dead code (§9 correction) — this track neither extends nor deletes it. Whether it is deleted or mounted is a founder decision raised in track D's Stop conditions.
5. **Touch shre-router or the shreai repo at all.** Not `chat-trace-store.ts`, not `conversation-memory.ts`, not `rag-injector.ts`, not `training.ts`. The `ingestConversationToVectors` tenant-blindness (§8d) is **reported, not fixed**. AROS-owned persistence must not feed the vector store.
6. **Touch the golden-record layer.** No new alias/identity table, no changes to `src/golden/*` (§14).
7. **Build a workspace-scoped admin conversations page** under `apps/web/src/redesign/pages/admin/`. The founder console (step 8) is the monitoring surface for v1. A member-facing "everyone's conversations" page would contradict the user-scoped RLS posture and needs founder ratification first.
8. **Modify `scripts/chat-eval/run.mjs`, `core.mjs`, `triage*.mjs`, or `battery.json`.** Track F owns those. Add a new file only.
9. **Extend `audit_log`'s schema or its `audit_tenant` policy.** Reasons in §4.1.
10. **Store any PAN, IP, or golden-record identifier** on the transcript tables.
11. **Add a scheduled job / cron.** Retention runs best-effort from the server (per the `purge_expired_cart_drafts` precedent). Wiring a scheduler is a `cadence`-layer decision and comes later.

---

## Collision warnings

### Package file-ownership register (RESOLVED 2026-07-24 — authoritative, identical in every brief)

Contested files across this nine-brief package. **One owning track per file.
The arrows are a merge order, not a preference.** If you are about to edit a file
this table does not assign to your track, stop and read the owner's brief first.

| File | OWNER (creates / restructures) | Merge order | Rule for non-owners |
|---|---|---|---|
| `src/server.ts` `/v1/chat` dispatch block (`:6783-6792`) | **C** (`c-honest-data-contract`) — introduces `arosChatJson()`, the single reply choke point | **C → D → I → A** | D inserts the 5th handler and emits through `arosChatJson`; I's exceptions branch emits through it too; **A lands LAST** and wraps whatever chain exists by then — *not* the four-handler snippet in this brief. |
| `src/server.ts` `proxyRequest` (`:948-1034`) | **B** (`b-auth-401-recovery`) steps 1–3 | **B(1–3) → A** | A different region from the dispatch block — the two are not the same edit. B lands its ~40-line auth classification first; A then hooks a `proxyRequest` that already classifies auth. |
| `apps/web/src/aros-ai/actions.ts` (NEW) | **D** — creates the file, `ChatActionType`, `CHAT_ACTION_TYPES`, `CHAT_ACTION_PRESENTATION`, `buildChatActions`, the parity test | **D → B(client steps 4–8)** | B **extends** the union with its four client-only types. Never a parallel type, never a second file. |
| `apps/web/src/redesign/shellData.ts:55` (`ChatMsg.actions`) | **D** | **D → B** | One optional field, added once, by D. |
| `apps/web/src/aros-ai/ArosChat.tsx` | **NOBODY — FROZEN** | — | Verified unmounted dead code. **No track in this package edits it.** Delete-or-mount is a founder decision, raised in D's Stop conditions. |
| `scripts/chat-eval/triage.mjs` + `triage-core.mjs` | **E** (`e-watchdog-unsilence`) — structural rewrite (`allIntents`, try/catch lanes) | **E → F** | F's `ENGINEERING_FAMILIES` + `FAMILY_UMBRELLA` work rebases onto E's restructure. |
| `scripts/chat-eval/core.mjs` | **F** (`f-real-transcript-eval`) steps 3–4 | **F → C(step 10)** | C's error-phrase-contract rewrite lands *after* F; both touch the hard-fail list at `core.mjs:105`. |
| `scripts/chat-eval/run.mjs` | **F** step 8 | — | **This track adds only the NEW file `from-transcripts.mjs`** and modifies nothing else in that directory. |
| `src/chat/redact.ts` + `src/chat/__fixtures__/pan-redaction.json` (NEW) | **D** (`d-actionable-errors` §Data contract 6a) — the package's **one** PAN redactor (`redactPan`, Luhn-gated) plus the shared fixture list | **D → A**; F mirrors | A **imports** `redactPan` (never declares it); F reimplements it verbatim in `.mjs` with a parity test against the same fixture file; G/H import it for owner-typed `entity_note.body`. Whoever lands first creates the file, the rest import. **Nobody writes a second PAN rule** — that is a stop condition. |
| `public.platform_settings` DDL | `supabase/migrations/20260723_platform_settings.sql:9-15` (already on main) | — | No track re-declares this table. E's heartbeat migration seeds a row and REVOKEs; it does **not** `CREATE TABLE`. |

**Note on C:** C's step 3 (`src/server.ts`) lands early; C's step 10 (`core.mjs`)
lands late, after F. They are two separate PRs — do not bundle them.

**Globally satisfiable merge order for `src/server.ts`:**
**B(1–3) → C(step 3) → D → I → A(migration + steps 4–11) → F(6,7,9,10).**
Inside `scripts/chat-eval/`: **E → F(3,4,5) → C(step 10) → F(6,7,9,10)**.
E, G, H are otherwise independent.

**What this means concretely for THIS track (A):** you are **last** into the
`/v1/chat` dispatch block. Before writing step 6, re-read the block — it will
contain **five** handler lines (`handleArosHealthPing`,
`handleArosConnectorHealthChat`, `handleArosAutomationChat`,
`handleArosStoreDataChat`, `handleArosSalesChat`) and they will be routing their
replies through `arosChatJson`. Wrap what is there; do not paste this brief's
four-handler snippet over it.

---

1. **`src/server.ts` is heavily co-edited and currently dirty elsewhere.** The primary checkout `C:/Users/nirpa/Documents/Projects/aros` is parked on branch `feat/chat-first-redesign` with roughly 25 uncommitted modified files **including `src/server.ts`**, plus untracked `apps/mcp-aros/`, `deploy/mcp-shre-ai/`, `data/`, `.claude/`.
   **Mitigation:** never edit by line number. Locate every edit with `grep -n "function <name>" src/server.ts` immediately before changing it. Do all work in a worktree (`~/.shre/worktrees/aros/<branch-slug>`), never in the primary checkout. Never run branch-switching or tree-mutating git commands in `Documents/Projects/aros` or `Documents/Projects/shreai`.
   **Your edits to `src/server.ts` are confined to five regions:** the `/v1/chat` block (`~:6783`), the `handlePlatformConsole` body (`~:3398`), the `platformMatch` regex (`~:7076`), a small block of new `/api/chat/*` routes near `~:7076`, and the import list at the top. Do not reformat or refactor anything else — the file is 7,214 lines and a wide diff will conflict.

2. **Track F (`f-real-transcript-eval`) owns `scripts/chat-eval/`.** Add `from-transcripts.mjs` only. If track F is running concurrently, coordinate before touching anything else in that directory.

3. **`apps/web/src/redesign/ConciergeChat.tsx` is actively worked** (composer/voice work landed in `a07c9dc` and `89bddbb`, both on main within the last day) **and is also edited by tracks B, C and D in this package** — B rewrites the failure half of `send()`, C reads `_shre` on the success half, D adds the `actions` read and the `onAction` prop. Keep your diff to the `useRef` + request-body + response-read lines and **re-read the file immediately before editing**. Do not touch the composer, voice hook, or canvas code.
   `apps/web/src/aros-ai/ArosChat.tsx` is **out of scope entirely** — unmounted dead code, frozen for the whole package (see the ownership register above).

4. **`supabase/migrations/` gains files from several tracks.** Filename `20260724_chat_transcripts.sql` — if another track already claimed that date, use `20260724_chat_transcripts_a.sql`. `check:migrations` concatenates all migrations, so a table created in one file and RLS-enabled in another still passes; do not rely on that, keep them together.
   **Lexical order vs. track F — resolved.** Migrations apply in filename order. Track F's `chat_grades` FKs `public.chat_message(id)`, so this file must sort **first**. `20260724_chat_grades.sql` would have sorted *before* `20260724_chat_transcripts.sql` (`g` < `t`) and failed on an unresolvable FK on a fresh apply. **Track F's migration has been renamed `20260725_chat_grades.sql`.** If you rename this file for any reason, keep it sorting before that one and say so in the PR body.
   **The package-wide applied order — authoritative list in `README.md` § "Migration apply order":** `20260724_canonical_strong_key_rls.sql` (G) → `20260724_chat_eval_heartbeat.sql` (E) → **`20260724_chat_transcripts.sql` (THIS FILE)** → `20260724_entity_note.sql` (G) → `20260724_item_profile.sql` (G) → `20260725_chat_grades.sql` (F) → `20260725_customer_profile.sql` (H). Seven files, five tracks, **no two briefs declare the same filename** — so the "another track already claimed that date" fallback above is a fallback only; `20260724_chat_transcripts.sql` is uncontested and `_a` is not needed. Nothing in the package depends on this file except F's `chat_grades`, and nothing this file needs comes from the package.

5. **`apps/web/src/pages/PlatformConsole.tsx`** may be touched by a monitoring track. Add a self-contained section; do not restructure the existing sections or the `api<T>` helper at `:49`.

6. **Production is a hand-managed fork.** Per workspace memory, prod AROS has diverged from the repo before (`supabase/catchup/20260715_prod_catchup.sql` exists because of it). Apply the migration to prod deliberately (step 2) and record it in the deploy log on the box; do not assume a deploy carries it.

---

## Rollback

Ordered from cheapest to most invasive.

1. **Turn writes off — no deploy needed.** Set `CHAT_PERSIST=0` (and `CHAT_SERVER_HISTORY=0`, `CHAT_PERSIST_CANARY=0`) and restart the AROS platform process. Every code path added in step 6 becomes a no-op; `captureJsonResponse` returns the raw `res`; chat behaves exactly as it did before this track. **Confirm with the founder before restarting anything** — restarts are outward-facing.

2. **Revert the code.** The change is confined to: two new files (`src/chat/transcript.ts`, `src/chat/persist.ts`), one new test file, one new migration, one new eval script, and five bounded regions of `src/server.ts` plus two client refs. `git revert <merge-sha>` restores the previous behaviour; nothing else depends on the new modules.

3. **Stop serving the read surfaces.** If only the reads are wrong, delete the `/api/chat/*` routes and the `conversations` alternation in the `platformMatch` regex (`src/server.ts:7076`) — writes continue harmlessly, data is retained.

4. **Drop the tables (destructive — last resort, founder approval required).**
```sql
DROP FUNCTION IF EXISTS public.purge_expired_chat_transcripts();
DROP TABLE IF EXISTS public.chat_message;       -- FK cascade from chat_conversation
DROP TABLE IF EXISTS public.chat_conversation;
```
This permanently destroys transcripts. Take a `pg_dump` of both tables first if there is any chance the data is wanted.
**If track F has already shipped `public.chat_grades`, drop it (or at least drop its FK) BEFORE this step** — `DROP TABLE public.chat_message` will otherwise fail on the dependent constraint, or require `CASCADE`, which would take the quality ledger with it. F's rollback section says the same thing from its side.

5. **Data-only rollback (keep the schema, purge the content).**
```sql
DELETE FROM public.chat_message;
DELETE FROM public.chat_conversation;
```
Use this if the concern is what was captured rather than that it was captured.
This is safe with `chat_grades` present: its `turn_id` FK is `ON DELETE SET NULL`, so the grades survive with a null pointer and the quality trend is not lost.

**Nothing in this track alters an existing table, policy, index, or column.** The migration is purely additive, so rollback never risks another feature's data.

---

## Stop conditions — come back to the founder, do not assume

Every "STOP" / "see Stop conditions" reference in this brief resolves here. If you reach one
of these and there is no answer on the PR, **stop and ask** — do not pick a default and keep
going. Q1, Q2 and Q7 are blocking; Q3–Q6 are checks that block only if they trip.

**Q1 — [BLOCKING, founder ratification] Is 90 days the right retention for chat transcripts?**
§4.1 ships `CHAT_RETENTION_DAYS` defaulting to **90**, hard delete. That number is the
author's proposal, not a ratified policy, and transcripts are the highest-PII surface in
AROS (a member's chat can name customers, phone numbers and employees). There is no
comparable precedent in the repo — the only existing retention policies are measured in
minutes or hours (`oidc_rp_sessions`, cart drafts).
*Do not ship `CHAT_PERSIST=1` against production until this is answered.* The code may
merge with the flag off in the meantime; the default is a config value, not a schema change.
**Recommendation: 90 days.** Shorter than 90 makes track F's quality trend unable to span a
retail season (the reason the window exists); longer accumulates PII with no stated purpose.
**Second, dependent question:** `CHAT_RETENTION_DAYS` is now an input to **track F** as well
— its `chat_grades` rows are joined to turns this purge deletes. Whatever number is chosen
must be written into F's brief too, not just A's. (Track F's `turn_id` FK is
`ON DELETE SET NULL` so grades survive the purge, but the *evidence text* behind a grade
does not.)

**Q2 — [BLOCKING if it trips] The step-3 canary shows `authResolved: false` for a surface
you intend to persist.**
The entire design assumes `authenticateRequest` yields `(tenant_id, user_id)` for the turn.
If a surface's requests do not resolve an identity, there are exactly three options and
**all three are founder calls, not implementation details**:
(a) drop that surface from v1 persistence (cheapest, honest, no schema change);
(b) make that client send a Bearer token — changes cost attribution and touches auth
semantics, which Non-goal 1 forbids in this track;
(c) invent a null-user row — **rejected here**: the RLS policy is `user_id = auth.uid()`, so
a null-user row has no correct reader and would need a second, unRLS'd tenancy concept.
**Recommendation: (a).** Persist only surfaces that already authenticate; report the rest.

**Q3 — Production already has a `chat%` table created out of band.** §1 is UNVERIFIED on
this point and prod has diverged from the repo before (`supabase/catchup/20260715_prod_catchup.sql`
exists because of it). Run, read-only, **before step 1**:
```sql
select table_name from information_schema.tables
 where table_schema='public' and table_name like 'chat%';
```
If anything comes back, **stop**. A `CREATE TABLE IF NOT EXISTS` against a differently-shaped
existing table is a silent no-op whose writes then fail at runtime, not at migration time.
Reconcile the shapes with the founder first.

**Q4 — You are about to hold the response flush to resolve an id.** Stop. §4.3 states one
answer: the id is pre-minted with `crypto.randomUUID()` and no I/O precedes `res.end()`.
If a requirement appears that genuinely needs a DB-resolved id on the wire, that is a
design change and needs a founder decision, because it puts Supabase on the chat hot path.

**Q5 — A surface value would have to be inferred rather than declared.** `surface` is
diagnostic-only and derived by `resolveSurface` (§4.2) from an explicit client field with a
header fallback. If you find yourself sniffing a user-agent or a referer to fill it, stop:
write `'unknown'`. An unreachable surface value in the CHECK constraint is not a defect and
must not be "fixed" by guessing.

**Q6 — The migration cannot be applied by an operator in a reasonable window.** Steps 2 and
3's run are **[FOUNDER/OPERATOR]** and gate only the flag flip (§ Sequencing). If someone
asks Codex to apply the migration itself, or to deploy, or to restart the platform process
to pick up `CHAT_PERSIST` — **stop**. Restarts and deploys are outward-facing actions and
are explicitly outside this track's authority (Non-goal 11, Rollback 1).

**Q7 — BLOCKING. Does this track ship the AI-activity-spine emitter (mission increment 5),
or stop at the actor stamp plus a flag-off seam?** Raised by § Bind to the AI activity
spine. Nobody on this package can answer it alone: the emit target depends on an **open
founder decision owned by the concurrent session** — which shre-meter runtime is live,
`server.mjs` (Express + Postgres, `/v1/events`) or `src/index.ts` (Hono + SQLite,
`/v1/costs/*`) — and the SDK change that makes an attributed event landable is unmerged on
`shreai/fix-meter-summary-contract`. shre-meter is also not running here and `cost_events`
is empty (mission D5).
**Recommendation: stop at the actor stamp + the single `CHAT_ACTIVITY_EMIT` seam, default
off.** Rationale: the durable rows carry `tenant_id` + `user_id` NOT NULL and FK-enforced
from day one, so nothing has to be re-attributed later; the emitter then becomes a one-line
flag flip owned by the spine's increment 5. Shipping an emitter against an unknown surface
is precisely how a second attribution path — the stop condition — gets created.
**Do not resolve this by choosing a runtime**: that decision belongs to the other session's
mission, and choosing wrong either leaves billing broken or breaks billing that works.
