# chat-eval — automated chat quality harness

Sends a fixed battery of operator questions (`battery.json`) to `/v1/chat` for
one or many workspaces, scores every reply against the platform's **own ground
truth** (`/api/store/summary`, `/api/connectors`), and writes JSONL + markdown
reports. Exit code gates deploys: non-zero when fleet pass rate <
`CHAT_EVAL_MIN_PASS` (default 0.7).

## Scoring

Deterministic checks (pure functions in `core.mjs`, tested in `core.test.mjs`):

| Check | Catches |
|---|---|
| `empty-reply` | raw `[]` / blank output leaked to the user |
| `tool-error` | "circuit breaker", "could not be loaded", "try again later"… |
| `misroute-sales-template` | non-sales question answered with the sales summary card |
| `ground-truth-mismatch` | numbers/names that contradict the workspace's own API data |
| `no-comparison` | "compare X to Y" answered without any comparison |
| `tenant-name-missing` | replies that say "the store" instead of the business name |
| `slow` | replies over the 20s latency budget |

Optional LLM judge (`--judge`) adds a qualitative 1–5 rubric via any
OpenAI-compatible endpoint (`JUDGE_BASE_URL`, `JUDGE_API_KEY`,
`JUDGE_MODEL` — use the shre-model-gateway).

## Run

```bash
# one workspace (password login)
node scripts/chat-eval/run.mjs --email op@example.com --password '...'

# a curated list
node scripts/chat-eval/run.mjs --accounts accounts.json   # [{email,password,name?,tenantId?}]

# every active workspace — no passwords needed; mints real user sessions via
# Supabase admin magiclink (generate_link -> verify). Run on the VPS where
# SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are already in /opt/aros-platform/.env
cd /opt/aros-platform && set -a && source .env && set +a && \
  node scripts/chat-eval/run.mjs --all --base https://app.aros.live
```

Reports land in `scripts/chat-eval/reports/<timestamp>/`:
`results.jsonl` (one row per question per workspace), `report-<workspace>.md`,
`summary.json` (fleet scoreboard).

## Triage — reports become tasks

`triage.mjs` closes the loop on the latest run (or `--run <dir>`):

- **Engineering defects** (`empty-reply`, `tool-error`, `misroute-*`,
  `no-comparison`, `tenant-name-missing`, `transport`) → GitHub issues on
  `CHAT_EVAL_REPO`, labeled `chat-eval` + `chat-eval:<family>`, one issue per
  (question, family) with affected workspaces and reply excerpts. Dedup by a
  fingerprint embedded in the issue body — recurring failures get a comment,
  not a duplicate. Needs `GITHUB_TOKEN` (repo scope).
- **Operational signals** (per-tenant `ground-truth-mismatch` etc.) + the
  fleet scoreboard → `POST CHAT_EVAL_DIGEST_URL` (owner-digest / shre-health
  webhook, optional `CHAT_EVAL_DIGEST_TOKEN`). Tenant-data problems are not
  code bugs, so they go to the health lane, not the issue tracker.

`--dry-run` prints what would be filed without writing anything.

## Automation

1. **Nightly fleet sweep (VPS):**
   ```
   17 9 * * * cd /opt/aros-platform && set -a && . ./.env && set +a && \
     node scripts/chat-eval/run.mjs --all >> /var/log/chat-eval.log 2>&1; \
     node scripts/chat-eval/triage.mjs >> /var/log/chat-eval.log 2>&1
   ```
2. **Post-deploy gate:** run single-workspace mode against the demo tenant in
   the launch pipeline right after the beta smoke test; a failing exit code
   blocks promotion.
3. **Reporting:** triage posts `summary.json` + operational signals to the
   digest webhook; alert when fleet pass rate drops or a family spikes.

## Caveats

- Eval chats are real chats: they hit real connectors and are **metered**.
  Exclude the eval traffic from billing (dedicated eval user per tenant, or an
  eval marker the metering pipeline drops) before enabling the nightly sweep.
- `--all` mints sessions for real owners; keep it on the VPS (service-role key
  never leaves the box) and consider a dedicated `eval@` member per tenant
  instead once provisioning supports it.
