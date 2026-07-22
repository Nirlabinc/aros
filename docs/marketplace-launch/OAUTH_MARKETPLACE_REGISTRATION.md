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

- [x] Create a Claude marketplace OAuth client in shre-id.
- [x] Add `https://claude.ai/api/mcp/auth_callback`.
- [ ] Keep the existing Claude Code local callback separate if used for local testing.
- [x] Prefer Authorization Code + PKCE/public client if supported.
- [x] If a client secret is required, store it only in the shre-secrets vault.
- [ ] Grant marketplace client audience `https://mcp.shre.ai/aros`.
- [ ] Verify a real Claude token against `https://mcp.shre.ai/aros/operator`.

Created shre-id client:

| Field | Value |
| --- | --- |
| App name | `AROS Retail Operations - Claude Hosted` |
| App ID | `382846025724854275` |
| Client ID | `382846025758408707` |
| App type | `OIDC_APP_TYPE_USER_AGENT` |
| Auth method | `OIDC_AUTH_METHOD_TYPE_NONE` |
| Redirect URI | `https://claude.ai/api/mcp/auth_callback` |
| Grant types | `authorization_code`, `refresh_token` |
| Response type | `code` |
| Access token type | `JWT` |

Claude directory submission is blocked on account entitlement: the current
`claude.ai` session for `info@rapidinfosoft.com` reports that organization
settings are available only on Claude Team and Enterprise plans when opening
`https://claude.ai/admin-settings/directory/submissions/new`.

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
