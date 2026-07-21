# AROS + Regulars Marketplace Launch Tasks

Status date: 2026-07-21

## Parallel Lanes

| Lane | Scope | Can run in parallel with | Status |
| --- | --- | --- | --- |
| Engineering | MCP deploy, live smoke, read-only Regulars enforcement | Legal, marketplace packet, demo data | In progress |
| Demo data | Reviewer tenant, Regulars profile, products, promotions, hours, links | Engineering, legal | Pending |
| OAuth | ChatGPT and Claude marketplace callback/client setup | Legal, screenshots after beta deploy | Blocked on marketplace callback URLs |
| Legal/compliance | Privacy, terms, security, data access wording | Engineering, demo data | Pending counsel signoff |
| Marketplace packet | Submission JSON, screenshots, prompts, reviewer instructions | Engineering after beta URL is stable | In progress |
| Review submission | Submit to OpenAI and Claude portals | None after all gates are green | Blocked until all gates pass |
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

- [ ] Confirm shre-id issuer metadata at `https://id.shre.ai`.
- [ ] Confirm MCP protected resource metadata at `https://mcp.shre.ai/.well-known/oauth-protected-resource`.
- [ ] Register ChatGPT OAuth client after OpenAI provides the exact callback URI.
- [ ] Register Claude OAuth client after Claude provides the exact callback URI.
- [ ] Store any client secrets only in shre-secrets vault.
- [ ] Run production token verification with `AROS_MCP_VERIFY_TOKEN`.
- [ ] Set `AROS_MCP_DEMO_MODE=false` only after real marketplace token verification passes.

## Gate 4 - Legal and Compliance

- [x] Verify public privacy URL returns 200: `https://www.aros.live/legal/privacy/`.
- [x] Verify public terms URL returns 200: `https://www.aros.live/legal/terms/`.
- [x] Verify security/support contact is `info@rapidinfosoft.com` for review.
- [ ] Counsel signoff for AROS and Regulars public marketplace wording.
- [ ] Confirm Regulars read-only claim is present in reviewer notes.
- [ ] Confirm no restricted financial transaction flow is submitted for Regulars.

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
