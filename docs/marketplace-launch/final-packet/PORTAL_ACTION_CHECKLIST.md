# Portal Action Checklist

Status date: 2026-07-21

## Already Ready

- Production MCP host is live: `https://mcp.shre.ai`.
- AROS operator endpoint is live: `https://mcp.shre.ai/aros/operator`.
- Regulars read-only endpoint is live: `https://mcp.shre.ai/regulars`.
- OAuth metadata endpoints return HTTP 200.
- Privacy and terms URLs return HTTP 200.
- Regulars live smoke for `demo-market` returns HTTP 200 for profile, links,
  product search, promotions, and hours.
- Regulars advertises only read-only tools.

## ChatGPT Portal

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

## Claude Portal

- [ ] Create the AROS Retail Operations connector entry.
- [ ] Add support/security contact: `info@rapidinfosoft.com`.
- [ ] Add privacy URL: `https://www.aros.live/legal/privacy/`.
- [ ] Add terms URL: `https://www.aros.live/legal/terms/`.
- [ ] Enter MCP URL: `https://mcp.shre.ai/aros/operator`.
- [ ] Copy the exact Claude hosted connector OAuth callback URI from the portal.
- [ ] Register that callback URI in shre-id for the Claude marketplace client.
- [ ] Verify a real Claude marketplace token with `verify:oauth`.
- [ ] Capture portal-required screenshots.
- [ ] Submit after legal approval.

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

