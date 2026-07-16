# AROS OIDC relying party

AROS is registered in the shared Shre application directory as the public
client `aros-web`. The canonical issuer is `https://id.shre.ai`, audience is
`aros-api`, and production callback is
`https://app.aros.live/auth/callback`. The client has no secret.

## Runtime

- `GET /auth/oidc/start` creates a ten-minute, browser-bound state transaction,
  an OIDC nonce, and an S256 PKCE verifier, then redirects to the discovered
  authorization endpoint.
- `GET /auth/callback` atomically consumes state, exchanges the code, verifies
  the RS256 ID token against discovery/JWKS, checks issuer, audience, expiry,
  application registry claims, and nonce, then maps the canonical subject to
  an active `tenant_members` workspace.
- `GET /auth/session` exposes only the local subject/workspace/role projection.
  Tokens remain server-side behind an opaque `Secure; HttpOnly; SameSite=Lax`
  cookie.
- `POST /auth/logout` deletes the local session, attempts refresh-token
  revocation when advertised by discovery, and expires the cookie.

API authorization accepts this local session only for its bound workspace.
Existing bearer authentication remains supported during migration. Owner/admin
checks continue to run inside individual server handlers.

## Configuration

The secret-free registry contract is compiled into the runtime and asserted
with `shre-sdk/application-identity`. `OIDC_REDIRECT_URI` may select only a URI
already present in that contract. `OIDC_SESSION_TTL_SECONDS` defaults to 3600.
Issuer, client ID, and audience are intentionally not freely overridable.

Migration `20260716_oidc_rp_sessions.sql` defines the locked-down durable state
schema, atomic single-use transaction RPC, lookup hashes, encrypted-envelope
columns, revocation timestamps, and TTL cleanup RPC. The runtime storage adapter
is consumed by `createSupabaseOidcStore`. Production defaults to and requires
`OIDC_STORE_MODE=supabase`; it refuses to start without a vault-injected
`AROS_OIDC_ENCRYPTION_KEY`. `OIDC_STORE_MODE=memory` is accepted only outside
production and exists for explicit single-process development.

Rollback is explicit: build with `VITE_AUTH_MODE=supabase` to retain the legacy
Supabase browser flow. `VITE_AUTH_MODE=central` uses `/auth/session`, redirects
login to `/auth/oidc/start`, and logs out through `/auth/logout`; no issuer token
or password is exposed to the SPA.
