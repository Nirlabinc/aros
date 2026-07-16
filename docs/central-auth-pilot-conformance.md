# Central auth pilot conformance

Audit date: 2026-07-16. This describes code present in the audited worktrees; it does not claim production deployment state.

| Contract | AROS | MIB007 | Sia |
|---|---|---|---|
| Central mode exists | Partial: `VITE_AUTH_MODE=central` disables Supabase startup and uses hosted shre-auth login | Partial: proxies `/api/auth/me` and workspace switching to shre-auth | Yes: `AUTH_MODE=required` gates HTTP and WebSocket requests |
| Authorization Code + PKCE consumer | Not evidenced; current hosted flow resumes `/oauth/authorize` after password + 2FA | Not evidenced; browser primarily uses BetterAuth cookie sessions | Resource server only; browser callback is referenced by tests but not the token verifier |
| Discovery + JWKS validation | Not in the AROS consumer | Platform JWT is accepted through shre-auth integration, while local sessions and agent JWTs remain separate | Yes, discovery with cached RS256 JWKS and known-key outage tolerance |
| Issuer and audience validation | Not evidenced in AROS browser session | Split across BetterAuth, local agent JWT, and shre-auth | Yes when required; audience may be blank in development |
| Workspace identity | Hosted login requires workspace selection; legacy UI still derives tenants from Supabase | Strong DB membership mapping and shre-auth workspace switch | No canonical workspace claim enforcement in `OidcAuthService` |
| Roles / authorization | Legacy Supabase metadata and tenant membership | DB roles plus mapped shre-auth memberships | Zitadel project-role claims and approval gate |
| Browser session | Hosted shre-auth HTTP-only session requested; legacy Supabase session remains | BetterAuth cookie plus `shre_token` cookie | `sia_access_token` HTTP-only-cookie path or bearer token |
| Logout | Legacy Supabase logout exists; centralized end-session/revocation not evidenced | BetterAuth sign-out path exists; federated logout not evidenced | No centralized end-session implementation evidenced |
| Service identity | AROS service-token paths exist for router integration | Local service-token file with optional cross-container trust | API keys / approval key remain break-glass paths |

## Safest convergence sequence

Canonical issuer decision: `https://id.shre.ai`. Product domains such as AROS are relying parties and must not publish alternate issuer identities for the same trust domain.

1. Register three distinct public clients and service identities at the canonical issuer. Never share client secrets.
2. Adopt `config/central-auth-consumer.template.json` per consumer, supplying IDs and audiences from environment/vault only.
3. Make each resource server verify issuer, audience, expiry and signature before trusting workspace or role claims.
4. Normalize `workspace_id` and `roles` at the auth boundary; map them to each application's internal membership model there.
5. Add callback state, nonce and PKCE tests, then enable central mode one consumer at a time.
6. Keep current break-glass credentials scoped, audited and unavailable to ordinary browser clients.

## Blocking gaps

- Existing consumers still contain issuer drift: AROS previously targeted `id.aros.live`, Sia defaults to the canonical `id.shre.ai`, and MIB retains local BetterAuth identity alongside shre-auth exchange. The template now pins `id.shre.ai`; runtime cutover remains required.
- The canonical claim schema and registered audiences are not checked into a non-secret registry.
- AROS central mode currently behaves like an issuer/login host, not a complete OIDC relying party.
- Federated logout, refresh rotation and revocation conformance are not demonstrated across all three.
