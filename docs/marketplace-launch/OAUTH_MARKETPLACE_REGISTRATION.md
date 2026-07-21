# Marketplace OAuth Registration

Status date: 2026-07-21

## Fixed Values

Use these values for both ChatGPT and Claude marketplace registration unless a marketplace explicitly requires a separate resource identifier.

| Field | Value |
| --- | --- |
| OAuth issuer | `https://id.shre.ai` |
| MCP resource / audience | `https://mcp.shre.ai/aros` |
| Protected resource metadata | `https://mcp.shre.ai/.well-known/oauth-protected-resource` |
| Authorization server metadata | `https://mcp.shre.ai/.well-known/oauth-authorization-server` |
| Operator MCP URL | `https://mcp.shre.ai/aros/operator` |
| Regulars MCP URL | `https://mcp.shre.ai/regulars` |
| Support/security contact | `info@rapidinfosoft.com` |

## ChatGPT

Blocked until the ChatGPT app/plugin submission UI provides the exact OAuth callback URI.

Expected callback pattern:

```text
https://chatgpt.com/connector/oauth/{callback_id}
```

Registration tasks:

- [ ] Create a ChatGPT marketplace OAuth client in shre-id.
- [ ] Add the exact ChatGPT callback URI.
- [ ] Prefer Authorization Code + PKCE/public client if the portal supports it.
- [ ] If a client secret is required, store it only in the shre-secrets vault.
- [ ] Grant marketplace client audience `https://mcp.shre.ai/aros`.
- [ ] Verify a real ChatGPT token against `https://mcp.shre.ai/aros/operator`.

## Claude

Hosted Claude surfaces use this callback URI:

```text
https://claude.ai/api/mcp/auth_callback
```

Keep Claude Code local loopback callbacks separate from this hosted connector
client.

Registration tasks:

- [ ] Create a Claude marketplace OAuth client in shre-id.
- [ ] Add `https://claude.ai/api/mcp/auth_callback`.
- [ ] Keep the existing Claude Code local callback separate if used for local testing.
- [ ] Prefer Authorization Code + PKCE/public client if supported.
- [ ] If a client secret is required, store it only in the shre-secrets vault.
- [ ] Grant marketplace client audience `https://mcp.shre.ai/aros`.
- [ ] Verify a real Claude token against `https://mcp.shre.ai/aros/operator`.

## Token Verification

After either marketplace can mint an access token:

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

Do not submit publicly until authenticated status is `200`.
