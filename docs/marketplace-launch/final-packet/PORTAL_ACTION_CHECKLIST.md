# Portal Action Checklist

Status date: 2026-07-22

## Already Ready

- Production MCP host is live: `https://mcp.shre.ai`.
- AROS operator endpoint is live: `https://mcp.shre.ai/aros/operator`.
- Regulars read-only endpoint is live: `https://mcp.shre.ai/regulars`.
- OAuth metadata endpoints return HTTP 200.
- Privacy and terms URLs return HTTP 200.
- Regulars live smoke for `demo-market` returns HTTP 200 for profile, links,
  product search, promotions, and hours.
- Regulars advertises only read-only tools.
- Focused marketplace regression suite passes: MCP tool contract, public
  Regulars API, and store risk/exception data.
- Production health reports `demoMode: false`.
- Unauthenticated operator calls return HTTP 401 with a bearer challenge, as
  expected for the protected AROS operator surface.
- GitHub Actions scheduling is fixed; staging deploy from `main` passes.
- Use the verified `www.aros.live` legal URLs below. Apex
  `aros.live/legal/...` is not part of the marketplace packet and currently
  returns 404.

## ChatGPT Portal

- [ ] Complete OpenAI developer identity verification for the current org.
- [ ] Create the AROS Retail Operations marketplace entry.
- [ ] Add support/security contact: `info@rapidinfosoft.com`.
- [ ] Add privacy URL: `https://www.aros.live/legal/privacy/`.
- [ ] Add terms URL: `https://www.aros.live/legal/terms/`.
- [ ] Enter MCP URL: `https://mcp.shre.ai/aros/operator`.
- [ ] Copy the exact ChatGPT OAuth callback URI from the portal.
- [ ] Register that callback URI in shre-id for the ChatGPT marketplace client.
- [ ] Verify a real ChatGPT marketplace token with `verify:oauth`.
- [ ] Capture portal-required screenshots.
- [ ] Submit after legal approval.

Current blocker: Chrome reached the OpenAI Platform plugin/app creation flow
for org `SiyaInfo`, project `Default project`, then OpenAI displayed
`Complete identity verification` before allowing a plugin upload or app draft.
Complete that verification in the portal, create/open the AROS app draft, scan
`https://mcp.shre.ai/aros/operator`, then copy the exact ChatGPT callback URI
from the app management page.

## Claude Portal

- [ ] Create the AROS Retail Operations connector entry.
- [ ] Add support/security contact: `info@rapidinfosoft.com`.
- [ ] Add privacy URL: `https://www.aros.live/legal/privacy/`.
- [ ] Add terms URL: `https://www.aros.live/legal/terms/`.
- [ ] Enter MCP URL: `https://mcp.shre.ai/aros/operator`.
- [x] Register `https://claude.ai/api/mcp/auth_callback` in shre-id for the Claude hosted marketplace client.
- [x] Open the portal from a Claude Team/Enterprise organization account.
- [x] Add the custom connector in Claude settings.
- [ ] Connect/authorize the custom connector through shre-id.
- [ ] Verify a real Claude marketplace token with `verify:oauth`.
- [ ] Capture portal-required screenshots.
- [ ] Submit after legal approval.

Current blocker: the Claude Team gate is resolved. The custom connector
`AROS Retail Operations` exists in Claude settings with server URL
`https://mcp.shre.ai/aros/operator` and OAuth client ID `382846025758408707`.
Clicking Connect reaches `https://id.shre.ai` and prompts for the password for
`info@rapidinfosoft.com`. Complete that shre-id sign-in manually or through the
approved credential flow, then return to the directory submission wizard and
continue from the Connection step.

## Token Verification Command

```powershell
$env:AROS_MCP_VERIFY_TOKEN = '<marketplace access token>'
pnpm --filter @aros/mcp-aros verify:oauth
```

Expected result:

```json
{
  "healthOk": true,
  "issuer": "https://id.shre.ai",
  "resource": "https://mcp.shre.ai/aros",
  "unauthenticatedStatus": 401,
  "authenticatedStatus": 200
}
```

