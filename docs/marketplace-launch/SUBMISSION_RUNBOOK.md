# AROS + Regulars Submission Runbook

Status date: 2026-07-21

## Preconditions

- Branch `feat/business-profile-regulars-readonly` is deployed to the MCP host.
- `https://mcp.shre.ai/.well-known/mcp/customer` reports:
  - name: `Regulars`
  - endpoint: `https://mcp.shre.ai/regulars`
  - auth type: `public-read-only`
- `POST https://mcp.shre.ai/regulars` returns exactly five Regulars tools.
- `POST https://mcp.shre.ai/aros/operator` requires OAuth and works with a reviewer token.
- Privacy and terms URLs return 200.
- Submission contact is `info@rapidinfosoft.com`.

## Final Local Commands

```powershell
pnpm install --frozen-lockfile
pnpm exec vitest run src/__tests__/mcp-aros-tools.test.ts src/__tests__/public-customer-api.test.ts
pnpm typecheck
pnpm --filter @aros/mcp-aros build
pnpm --filter @aros/mcp-aros verify:oauth
```

## Final Live Smoke

```powershell
Invoke-RestMethod https://mcp.shre.ai/health
Invoke-RestMethod https://mcp.shre.ai/.well-known/mcp/operator
Invoke-RestMethod https://mcp.shre.ai/.well-known/mcp/customer
```

```powershell
$body = '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
Invoke-RestMethod https://mcp.shre.ai/regulars -Method Post -ContentType 'application/json' -Body $body
```

For operator OAuth, run with a real marketplace token:

```powershell
$env:AROS_MCP_VERIFY_TOKEN = '<marketplace access token>'
pnpm --filter @aros/mcp-aros verify:oauth
```

## OpenAI Submission

1. Open the ChatGPT plugin/app submission portal.
2. Confirm organization verification and app management permissions.
3. Enter AROS listing metadata from `apps/mcp-aros/marketplace/chatgpt-submission.json`.
4. Use `https://mcp.shre.ai/aros/operator` for the operator MCP surface.
5. Use `https://mcp.shre.ai/regulars` for the Regulars read-only companion surface where the portal allows it.
6. Copy reviewer prompts from `docs/marketplace-launch/REVIEWER_PROMPTS.md`.
7. Add screenshots captured from the deployed beta flow.
8. Add support/security contact: `info@rapidinfosoft.com`.
9. Submit only after real OAuth callback/client verification passes.

## Claude Submission

1. Open the Claude connector submission portal.
2. Enter connector metadata from `apps/mcp-aros/marketplace/claude-connector.json`.
3. Use `https://mcp.shre.ai/aros/operator` for AROS.
4. Use `https://mcp.shre.ai/regulars` for Regulars where a separate/customer connector listing is allowed.
5. Add the privacy, terms, icon, test credentials, and reviewer prompts.
6. Add support/security contact: `info@rapidinfosoft.com`.
7. Submit after OAuth callback/client verification passes.

## Do Not Submit If

- `/regulars` returns 404.
- `/.well-known/mcp/customer` still says `AROS Customer Commerce`.
- Any Regulars tool can create carts, checkout, orders, payments, profile edits, POS writes, connector writes, or external-page updates.
- Demo tenant has real merchant secrets or customer PII.
- OAuth token verification has not passed with real marketplace-issued client settings.
- Legal/privacy/terms pages are not approved for public marketplace review.
