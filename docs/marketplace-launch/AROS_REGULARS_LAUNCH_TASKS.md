# AROS + Regulars Marketplace Launch Tasks

Status date: 2026-07-22

## Parallel Lanes

| Lane | Scope | Can run in parallel with | Status |
| --- | --- | --- | --- |
| Engineering | MCP deploy, live smoke, read-only Regulars enforcement | Legal, marketplace packet, demo data | Ready for portal token smoke |
| Demo data | Reviewer tenant, Regulars profile, products, promotions, hours, links | Engineering, legal | Complete for reviewer demo |
| OAuth | ChatGPT and Claude marketplace callback/client setup | Legal, screenshots after beta deploy | ChatGPT identity/callback pending; Claude connector added, shre-id sign-in pending |
| Legal/compliance | Privacy, terms, security, data access wording | Engineering, demo data | Pending counsel signoff |
| Marketplace packet | Submission JSON, screenshots, prompts, reviewer instructions | Engineering after beta URL is stable | Packet complete; screenshots blocked by portals |
| Review submission | Submit to OpenAI and Claude portals | None after all gates are green | Blocked until all gates pass |
| CI/deploy | GitHub Actions deploy workflow scheduling and staging smoke | Engineering | Fixed; staging deploy passes |
| Phase 2 white-label | RapidRMS/private-label listings and tenant branding | Starts after Phase 1 submission | Deferred |

## Gate 1 - Beta MCP Deploy

- [x] Regulars code exposes only read-only tools.
- [x] Regulars public API exposes only `GET /profile`, `/products`, `/promotions`, `/hours`, `/links`.
- [x] Cart, checkout, order, payment, POS-write, connector-write, and external-page-write paths are removed from Regulars.
- [x] Local tests passed: 29 targeted marketplace/read-only tests.
- [x] Local typecheck passed.
- [x] Feature branch pushed: `feat/business-profile-regulars-readonly`.
- [x] PR opened: `https://github.com/Nirlabinc/aros/pull/142`.
- [x] Deploy branch `feat/business-profile-regulars-readonly` to MCP host.
- [x] Confirm current live `https://mcp.shre.ai/health` returns OK.
- [x] Confirm current live `https://mcp.shre.ai/.well-known/mcp/operator` returns OK.
- [x] Confirm live `https://mcp.shre.ai/.well-known/mcp/customer` reports endpoint `https://mcp.shre.ai/regulars`.
- [ ] Confirm live `POST https://mcp.shre.ai/aros/operator` with OAuth lists operator tools.
- [x] Confirm live `POST https://mcp.shre.ai/regulars` lists Regulars tools.
- [x] Confirm current live legacy alias `POST https://mcp.shre.ai/aros/customer` still lists 5 customer tools.

## Gate 2 - Demo Tenant and Data

- [x] Create reviewer tenant `NirLab Demo Market`.
- [x] Create business profile metadata for `demo-market`.
- [x] Publish Regulars links: website, Google Maps, Apple Maps, Facebook, Instagram, support, legal, ChatGPT install, Claude install.
- [x] Seed public products projection.
- [x] Seed public promotions.
- [x] Seed store hours.
- [x] Verify all Regulars endpoints return read-only envelopes.
- [x] Verify no customer PII, real POS secrets, or live merchant credentials are present.

## Gate 3 - OAuth

- [x] Confirm shre-id issuer metadata at `https://id.shre.ai`.
- [x] Confirm MCP protected resource metadata at `https://mcp.shre.ai/.well-known/oauth-protected-resource`.
- [ ] Complete OpenAI developer identity verification and register ChatGPT OAuth client after OpenAI provides the exact callback URI.
- [x] Register Claude OAuth client with `https://claude.ai/api/mcp/auth_callback`.
- [x] Store any client secrets only in shre-secrets vault.
- [ ] Run production token verification with `AROS_MCP_VERIFY_TOKEN`.
- [x] Confirm production `AROS_MCP_DEMO_MODE=false`.

## Gate 4 - Legal and Compliance

- [x] Verify public privacy URL returns 200: `https://www.aros.live/legal/privacy/`.
- [x] Verify public terms URL returns 200: `https://www.aros.live/legal/terms/`.
- [x] Verify security/support contact is `info@rapidinfosoft.com` for review.
- [ ] Counsel signoff for AROS and Regulars public marketplace wording.
- [x] Confirm Regulars read-only claim is present in reviewer notes.
- [x] Confirm no restricted financial transaction flow is submitted for Regulars.

## Gate 5 - Marketplace Packet

- [x] ChatGPT draft metadata exists.
- [x] Claude connector draft metadata exists.
- [x] Submission contact is `info@rapidinfosoft.com`.
- [x] Regulars metadata uses `https://mcp.shre.ai/regulars`.
- [ ] Add final screenshots.
- [x] Add reviewer test prompts for AROS operator.
- [x] Add reviewer test prompts for Regulars read-only customer interactions.
- [x] Add submission runbook.
- [ ] Add demo credentials after OAuth client setup.
- [x] Run final JSON validation.

## Execution Log

2026-07-21:

- Passed `pnpm exec vitest run src/__tests__/mcp-aros-tools.test.ts src/__tests__/public-customer-api.test.ts`.
- Passed `pnpm typecheck`.
- Passed `pnpm --filter @aros/mcp-aros build`.
- Passed `pnpm --filter @aros/mcp-aros verify:oauth` against live metadata; authenticated token test is pending marketplace OAuth setup.
- Passed JSON validation for ChatGPT and Claude marketplace metadata.
- Committed `1907edb Prepare AROS and Regulars marketplace launch`.
- Pushed branch `feat/business-profile-regulars-readonly` to `origin`.
- Opened PR `https://github.com/Nirlabinc/aros/pull/142`.
- Merged PR `https://github.com/Nirlabinc/aros/pull/142` with squash.
- Staged and rebuilt `/opt/aros-mcp`; public Regulars metadata now reports
  name `Regulars`, endpoint `https://mcp.shre.ai/regulars`, auth
  `public-read-only`, and exactly 5 read-only tools.
- Patched `/opt/aros-platform/src/public/customer-api.ts` with the read-only
  Regulars handler and restarted `aros-platform`.
- Seeded synthetic `demo-market` reviewer tenant/profile/links/hours/products.
  Production does not currently expose the `public_promotions` table through
  Supabase schema cache, so demo promotions use the synthetic fallback path.
- Live Regulars tool-call smoke passed for:
  `regulars_get_business_profile`, `regulars_get_links`,
  `aros_customer_search_products`, `aros_customer_get_promotions`, and
  `aros_customer_get_business_hours`.
- Live endpoint audit:
  - `https://mcp.shre.ai/health` returned 200.
  - `https://mcp.shre.ai/.well-known/mcp/operator` returned 200.
  - `https://mcp.shre.ai/.well-known/mcp/customer` returned 200 and reports `Regulars`.
  - `POST https://mcp.shre.ai/regulars` returned 5 Regulars tools.
  - `POST https://mcp.shre.ai/aros/customer` returned the same 5 Regulars tools as a compatibility alias.
  - `POST https://mcp.shre.ai/aros/operator` returned 401 without OAuth, which is expected for a protected operator surface.
- Local background smoke using `Start-Process` was blocked by tool policy before execution; run `pnpm --filter @aros/mcp-aros smoke` after deploy or from an allowed shell session.
- GitHub deploy workflow run `https://github.com/Nirlabinc/aros/actions/runs/29859156916` remains queued; production was patched directly on the VPS because the workflow did not start.
- Merged final marketplace packet in PR `https://github.com/Nirlabinc/aros/pull/149`.
- Production `https://mcp.shre.ai/health` reports `demoMode: false`; unauthenticated operator calls return 401 with `WWW-Authenticate`.
- Claude hosted callback is known from Claude connector docs: `https://claude.ai/api/mcp/auth_callback`.
- Merged and deployed PR `https://github.com/Nirlabinc/aros/pull/150`; live Regulars tools now advertise `securitySchemes: [{ type: "noauth" }]` and the running container contains operator OAuth `securitySchemes`.
- Created hosted Claude shre-id client `382846025758408707` (`AROS Retail Operations - Claude Hosted`) with callback `https://claude.ai/api/mcp/auth_callback`, PKCE/no-secret, authorization-code + refresh-token grants, and JWT access tokens.
- OpenAI plugin portal opened to `https://platform.openai.com/login?next=%2Fplugins`; ChatGPT callback remains blocked until a signed-in account with `api.apps.write` opens the app management page.
- Claude directory submission portal opened to `https://claude.ai/admin-settings/directory/submissions/new`; current `info@rapidinfosoft.com` session is blocked because organization settings require a Claude Team/Enterprise plan.

2026-07-22:

- Passed focused marketplace regression suite:
  `pnpm exec vitest run src/__tests__/mcp-aros-tools.test.ts src/__tests__/public-customer-api.test.ts src/__tests__/store-risk-exception-data.test.ts`
  (47 tests).
- Passed `pnpm --filter @aros/mcp-aros typecheck`.
- Live production smoke:
  - `https://mcp.shre.ai/health` returned OK with `demoMode: false` and
    resource `https://mcp.shre.ai/aros`.
  - `https://mcp.shre.ai/.well-known/mcp/operator` reports endpoint
    `https://mcp.shre.ai/aros/operator`.
  - `https://mcp.shre.ai/.well-known/mcp/customer` reports endpoint
    `https://mcp.shre.ai/regulars`.
  - `POST https://mcp.shre.ai/regulars` lists 5 Regulars read-only tools.
  - Unauthenticated `POST https://mcp.shre.ai/aros/operator` returns 401,
    which is expected until a marketplace OAuth token is minted.
- Reconfirmed OpenAI portal blocker in Chrome:
  `https://platform.openai.com/login?next=%2Fplugins` is still at Platform
  login. Need a signed-in OpenAI org account with app/plugin management access
  to reveal the exact ChatGPT callback URI.
- Reconfirmed Claude portal blocker in Chrome:
  `https://claude.ai/admin-settings/directory/submissions/new` says
  organization settings require a Claude Team/Enterprise plan for
  `info@rapidinfosoft.com`'s organization.
- GitHub deploy workflow runs `29859156916` and `29860502448` remain queued.
  Production is already manually deployed and healthy; this remains a CI/org
  scheduling gate, not a current MCP readiness blocker.

2026-07-22 blocker closeout:

- Fixed GitHub Actions scheduling:
  - Repository Actions were disabled (`enabled: false`); enabled Actions with
    `allowed_actions: all`.
  - New PR checks now run and pass.
  - The old queued deploy runs `29859156916` and `29860502448` still return
    GitHub API 500 on cancel; treat them as stale pre-enable artifacts.
- Fixed staging deploy workflow:
  - PR `https://github.com/Nirlabinc/aros/pull/158` merged at
    `993fcaa2ef4ecf4ee05f8fb976cd9c58ca3a6bb5`.
  - Staging deploy run `https://github.com/Nirlabinc/aros/actions/runs/29889050598`
    completed successfully.
  - `https://beta.aros.live` and `https://dev.aros.live` returned HTTP 200
    after deploy.
- Reconfirmed live marketplace readiness:
  - MCP health, OAuth protected-resource metadata, OAuth authorization-server
    metadata, operator MCP metadata, and Regulars MCP metadata return HTTP 200.
  - `POST https://mcp.shre.ai/regulars` lists 5 tools; all advertise
    `readOnlyHint: true`, `destructiveHint: false`, and
    `securitySchemes: [{ type: "noauth" }]`.
  - `https://www.aros.live/legal/privacy/` and
    `https://www.aros.live/legal/terms/` return HTTP 200.
  - Apex `https://aros.live/legal/...` still returns 404, but marketplace
    packet URLs intentionally use the verified `www.aros.live` legal URLs.
- Reconfirmed current external gates:
  - OpenAI Platform reaches plugin/app creation under org `SiyaInfo`, project
    `Default project`, but creation is blocked by OpenAI's
    `Complete identity verification` gate. ChatGPT OAuth callback discovery
    remains pending until verification is completed.
  - Claude Team access is active and the directory submission wizard opens at
    `https://claude.ai/admin-settings/directory/submissions/new`.
  - Claude custom connector `AROS Retail Operations` was added in Claude
    settings with server URL `https://mcp.shre.ai/aros/operator`, OAuth client
    ID `382846025758408707`, no client secret, and individual sign-in.
  - Clicking Claude Connect starts the OAuth flow at `https://id.shre.ai`; it is
    blocked at the password screen for `info@rapidinfosoft.com`.
  - Real marketplace-token verification remains pending until ChatGPT or Claude
    mints a token.

## Gate 6 - Submit

- [ ] Submit AROS to ChatGPT plugin/app submission portal.
- [ ] Submit AROS/Regulars remote connector to Claude connector directory portal.
- [ ] Track review feedback.
- [ ] Respond to review findings.
- [ ] Publish once approved.

## Phase 2 - White-label / Private-label

- [ ] Define tenant branding model for marketplace listings.
- [ ] Confirm trademark and authorization for RapidRMS-branded listing.
- [ ] Decide per-label OAuth client strategy.
- [ ] Decide per-label listing support/security/legal contacts.
- [ ] Build RapidRMS-specific submission packet.
- [ ] Submit only after Phase 1 AROS + Regulars is stable.
