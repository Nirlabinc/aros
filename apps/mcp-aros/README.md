# AROS MCP Facade

Remote MCP facade for ChatGPT Apps SDK and Claude connectors.

This service is intentionally thin. It exposes the public marketplace tool
contract and forwards authenticated requests to the existing AROS API.

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `5468` | HTTP port for the MCP facade. |
| `AROS_API_BASE` | unset | Existing AROS API base URL, for example `https://app.aros.live`. |
| `AROS_MCP_DEMO_MODE` | `false` | Return synthetic demo data when AROS API is not configured. |
| `AROS_OPERATOR_MCP_URL` | `https://mcp.shre.ai/aros/operator` | Public operator MCP URL in metadata. |
| `AROS_CUSTOMER_MCP_URL` | `https://mcp.shre.ai/regulars` | Public Regulars read-only MCP URL in metadata. |
| `AROS_OAUTH_ISSUER` | `https://id.shre.ai` | OIDC issuer used for JWT validation. |
| `AROS_MCP_RESOURCE` | `https://mcp.shre.ai/aros` | OAuth resource/audience for marketplace tokens. |

## Local Run

```powershell
pnpm --filter @aros/mcp-aros dev
```

Health:

```powershell
Invoke-RestMethod http://localhost:5468/health
```

List MCP tools:

```powershell
Invoke-RestMethod http://localhost:5468/mcp -Method Post -ContentType 'application/json' -Body '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

## Production Notes

- Put this behind TLS at `https://mcp.shre.ai/aros/operator` and
  `https://mcp.shre.ai/regulars`. Keep `/aros/customer` only as a
  compatibility alias if needed.
- Use NirLab/shre-id OAuth before marketplace submission.
- Forward the caller bearer token to AROS; AROS remains the policy authority.
- Keep write-capable tools out of v1. `aros_draft_action` must create drafts
  only.

## OAuth Verification

Before marketplace submission, verify metadata and auth behavior:

```powershell
pnpm --filter @aros/mcp-aros verify:oauth
```

After a ChatGPT or Claude OAuth client can mint a token for
`https://mcp.shre.ai/aros`, run:

```powershell
$env:AROS_MCP_VERIFY_TOKEN='<access-token>'
pnpm --filter @aros/mcp-aros verify:oauth
```

Only flip production `AROS_MCP_DEMO_MODE=false` after the token test passes.
