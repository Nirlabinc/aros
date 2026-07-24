# EVIDENCE (not a brief) — root cause of the "Invalid or expired passport" 401

Traced 2026-07-23 against `origin/main`. This is the mechanism behind the
outage that triggered the whole mission. **Track B must design against this;
tracks C/D inherit the honesty problem it creates.**

## The failure path

`src/server.ts` proxies `/v1/*` to shre-router. For an authenticated browser it
terminates user auth and swaps in a service passport (`origin/main:src/server.ts`
~L980–L1002):

```ts
if (upstreamPath.startsWith('/v1/') && routerPassportToken) {
  if (!headers.has('authorization')) {
    headers.set('Authorization', `Bearer ${routerPassportToken}`);   // anon/demo path — works
  } else {
    const auth = await authenticateRequest(req);
    if (auth) {
      // …wallet freeze gate…
      const routerTenant = await routerTenantFor(auth.tenantId);
      headers.set('Authorization', `Bearer ${await passportForTenant(routerTenant)}`);
      if (!headers.has('x-tenant-id')) headers.set('x-tenant-id', routerTenant);
    }
    // ← NO ELSE. auth === null falls straight through.
  }
}
```

**When `authenticateRequest` returns `null` there is no else branch.** The
browser's Supabase access token is forwarded to shre-router untouched. The
router speaks passport JWTs only, so it rejects it at
`packages/shre-sdk/src/passport-client.ts:171`:

```ts
return c.json({ error: 'Invalid or expired passport', code: 'INVALID_TOKEN' }, 401);
```

That is verbatim the string six of twelve eval questions returned at
2026-07-23T07:45Z. The in-file comment above the block already documents this
exact failure mode ("forwarding that verbatim made every authed user's chat 401
while anonymous demo chat … worked") — the fix was applied to the success path
and **the null path was left forwarding the token it knows will be rejected.**

## Why some answers still worked

The deterministic handlers (`handleArosAutomationChat`, `handleArosStoreDataChat`,
`handleArosSalesChat`, plus the connectors/low-stock handlers) run **before**
this proxy on the `/v1/chat` route. So sales-today, low-stock, connectors,
top-items and multi-part answered normally while every question that fell
through to the model lane 401'd. This asymmetry is diagnostic, not coincidence —
it localises the fault to the proxy hop, not the model or the data path.

## Six distinct causes, one indistinguishable symptom

`authenticateRequest` (`origin/main:src/server.ts:2557`) returns `null` for:

1. OIDC session present but `getRequestedTenantId(req) !== oidcSession.workspaceId`.
2. No `Bearer` header.
3. `supabase.auth.getUser(token)` errors, or returns no user — genuine expiry.
4. No active `tenant_members` row for the user (missing, `status != 'active'`,
   or scoped to a different tenant) — after two attempts with a 250 ms sleep.
5. `getRequestedTenantId` resolves a tenant the membership query then rejects.
6. **`catch { return null }`** — ANY thrown exception: Supabase outage, network
   blip, admin-client misconfiguration, rate limit.

All six produce the identical user-visible string. A **workspace-switch header
mismatch** is presented exactly like an **expired session**, and a **transient
Supabase failure** is presented exactly like both. Note cause 1 and 5 hinge on
`getRequestedTenantId`, which reads `x-aros-tenant-id` then `x-tenant-id` — and
`apps/web/src/redesign/ConciergeChat.tsx` sends `x-tenant-id`,
`x-aros-tenant-id` **and** `X-Workspace-ID` on every turn. If those ever
disagree with the session's workspace, chat 401s permanently for that user.

Cause 6 is the one that matches the observed *escalation* (partial 401s at
07:45Z → total login failure by 08:47Z): a swallowed upstream auth failure
degrades exactly this way.

## What the user sees

`apps/web/src/redesign/ConciergeChat.tsx` does `if (!res.ok) throw new
Error(\`HTTP ${res.status}\`)`, and its catch renders:

> I couldn't complete that request (HTTP 401). Try again in a moment.

Retrying cannot fix any of the six causes. And `setDraft('')` fires **before**
the request, so the user's typed text is gone from the input on every failure.

## Design implications (fold into track B)

1. The proxy must **handle `auth === null` explicitly** on `/v1/*` — never
   forward a credential it knows the downstream rejects. Fail closed with a
   typed code the client can act on.
2. The six causes must be **distinguishable** on the wire — at minimum
   `SESSION_EXPIRED` vs `TENANT_MISMATCH` vs `NOT_A_MEMBER` vs `AUTH_UPSTREAM_
   UNAVAILABLE`. Only the first is a "sign in again"; the second is "switch
   workspace"; the third is "ask an owner for access"; the fourth is "retry".
   Today's single 401 makes correct recovery impossible by construction.
3. `catch { return null }` must **not** collapse infrastructure failure into
   authentication failure. Log it, classify it, surface it as retryable.
4. Client-side retry alone is NOT a fix — it only helps cause 6.
5. Server-side observability: none of these six ever produced a log line the
   founder saw. Whatever track A stores must record the classified auth failure
   against the conversation, or this recurs invisibly.

## Regression window

Eval report timestamps are **UTC**; the box is EDT (UTC−4). 12/12 pass at
06:53Z = **02:53 EDT**; 5/12 at 07:45Z = **03:45 EDT**. aros commits inside that
window: `89bddbb` voice-hook regression tests (02:57), the four email-template
commits (03:24), `b3fb4ef` attach-sheet fix (03:36). Just before it: `fdcf0ff`
prepaid token wallet (02:17) and `c5f1b91` promo codes (02:51).

**The wallet is a lead, not a conclusion.** The freeze gate returns HTTP **402**
`WALLET_FROZEN`, not 401 — so it is not the direct cause of the observed error.
But it is flag-gated on `WALLET_ENFORCE` and shipped hours earlier, and the
nightly eval bills real metered chat against this same founder workspace
(`scripts/chat-eval` runs are NOT metering-exempt — see the note in
`~/.shre/tasks/chat-eval-nightly.ps1`). **UNVERIFIED:** whether `WALLET_ENFORCE=1`
in prod and what the workspace balance is. Requires reading
`/opt/aros-platform/.env` on aros-vps — operator action, not inferable here.

## Not attempted

No login was attempted beyond the single failed run at 2026-07-24T00:17Z.
Repeated failures risk locking `npatel@rapidrms.com` out of prod. Founder must
confirm by hand whether `~/.shre/secrets/chat-eval.env` still holds valid
credentials.
