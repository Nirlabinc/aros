# Track E — Make the chat-eval watchdog fail loudly

**Slug:** `e-watchdog-unsilence`
**Repo of record:** `Nirlabinc/aros` (this worktree is a clean checkout of `origin/main`)
**Executor:** Codex, assumed zero prior context on this codebase.

---

## Track

Make the nightly chat-eval harness *incapable of failing quietly*: a run that errors
entirely, a run whose triage crashes, and a run that never happens at all must each
produce a visible, deduplicated, human-reaching signal — instead of today's outcome,
where a full-day production outage produced a Windows Task Scheduler result of
`LastTaskResult: 0` (SUCCESS) and told nobody.

**User-visible outcome:** when AROS chat breaks (or when the thing that watches AROS
chat breaks), a human learns about it the same day, once — not once per minute, and
not never.

---

## Verified ground truth

Every claim below was opened and read during authoring. Anything I could not verify is
marked **UNVERIFIED** with the exact check that would settle it.

### The harness lives in two places — know which is which

| Thing | Path | Notes |
|---|---|---|
| Source of record | `scripts/chat-eval/` in `Nirlabinc/aros` (this worktree) | What you edit |
| What actually runs nightly | `C:/Users/nirpa/.shre/worktrees/aros/chat-eval-main/scripts/chat-eval/` | A **git worktree** of the same repo on the founder's Windows box |
| The runner | `C:/Users/nirpa/.shre/tasks/chat-eval-nightly.ps1` | PowerShell, **not in any repo** |
| The log | `C:/Users/nirpa/.shre/logs/chat-eval.log` | Append-only, 81 lines as of authoring |
| Credentials | `C:/Users/nirpa/.shre/secrets/chat-eval.env` | Plaintext on disk |
| Scheduler | Windows Task `Shre-ChatEval`, 04:47 America/New_York = 08:47Z | Verified via `Get-ScheduledTaskInfo` |

### Defect 1 — triage crashes on the runs that matter most (CONFIRMED)

`scripts/chat-eval/triage.mjs:35-36`:

```js
const summary = JSON.parse(readFileSync(join(runDir, 'summary.json'), 'utf8'));
const rows = readFileSync(join(runDir, 'results.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
```

- `scripts/chat-eval/run.mjs:199` — `mkdirSync(runDir, { recursive: true })` runs
  unconditionally, *before* any login. An errored run still produces a directory.
- `scripts/chat-eval/run.mjs:229` — `appendFileSync(join(runDir, 'results.jsonl'), …)`
  is the **only** writer of `results.jsonl` and it sits inside the per-workspace `try`.
  Login fails ⇒ the file is never created.
- `scripts/chat-eval/run.mjs:233-236` — `catch (e)` pushes
  `{ workspace, error: String(e), total: 0, pass: 0, warn: 0, fail: 0, passRate: 0 }`.
- `scripts/chat-eval/run.mjs:244` — `writeFileSync(join(runDir,'summary.json'), …)` runs
  **always**, including on total failure.

So on a totally-failed run the run directory contains **exactly one file**. Verified by
listing `…/chat-eval-main/scripts/chat-eval/reports/2026-07-23T08-47-04/` → `summary.json`
and nothing else. Its content, verbatim:

```json
{
  "when": "2026-07-23T08:47:04.198Z",
  "base": "https://app.aros.live",
  "workspaces": [
    { "workspace": "npatel@rapidrms.com",
      "error": "TimeoutError: The operation was aborted due to timeout",
      "total": 0, "pass": 0, "warn": 0, "fail": 0, "passRate": 0 }
  ],
  "passRate": 0
}
```

**The outage signal is already on disk, fully structured, one line above the crash.**
`triage.mjs:35` reads it and then `triage.mjs:36` dies reading a file it does not need
for the error case. Live proof, `C:/Users/nirpa/.shre/logs/chat-eval.log:68`:

```
Error: ENOENT: no such file or directory, open '…\reports\2026-07-23T08-47-04\results.jsonl'
    at readFileSync (node:fs:440:20)
    at file:///…/scripts/chat-eval/triage.mjs:36:14
```

Consequence, stated precisely: **a partial failure files GitHub issues; a total outage
files nothing.** The worst case yields the least signal.

`scripts/chat-eval/triage.mjs:38` — `const { issues, operational } = buildTriage(rows);`
is the only call into the pure core, and it takes `rows` only. `summary` is never
classified. That line is the extension seam.

### Defect 2 — a GitHub API error kills the digest lane too (CONFIRMED, not in the original seed)

`scripts/chat-eval/triage.mjs:50`:

```js
if (!res.ok) throw new Error(`github ${path}: HTTP ${res.status} ${await res.text()}`);
```

`gh()` throws on *any* non-2xx as an unhandled top-level rejection, killing the process
before the digest lane at `triage.mjs:82` is ever reached. Observed live on 2026-07-21,
`chat-eval.log:18`:

```
Error: github /repos/Nirlabinc/aros/issues: HTTP 410 {"message":"Issues has been disabled in this repository.", … "status":"410"}
```

Both lanes lost from one API error. Issues are enabled again today, but a rate limit,
token expiry, or permission change reproduces it exactly.

### Defect 3 — the digest lane has never run (CONFIRMED)

`scripts/chat-eval/triage.mjs:82` — `const digestUrl = process.env.CHAT_EVAL_DIGEST_URL;`
`triage.mjs:97` logs `'[triage] CHAT_EVAL_DIGEST_URL not set — digest lane skipped'`.
Seen at `chat-eval.log:45` and `chat-eval.log:55`. The variable is not set anywhere in
`chat-eval-nightly.ps1` and not in `chat-eval.env` (key names are
`CHAT_EVAL_EMAIL`, `CHAT_EVAL_PASSWORD`, `CHAT_EVAL_BASE`, `CHAT_EVAL_REPO` — values not
read or printed).

### Defect 4 — the nightly worktree ran stale code (CONFIRMED, and trivially fixable)

`C:/Users/nirpa/.shre/tasks/chat-eval-nightly.ps1:25`:

```powershell
git pull --ff-only 2>&1 | Add-Content $Log
```

Failure is logged and ignored. `chat-eval.log:60`:
`from the remote, but no such ref was fetched.`

Verified state of `C:/Users/nirpa/.shre/worktrees/aros/chat-eval-main` (read-only):

```
$ git rev-parse --abbrev-ref HEAD                       → chat-eval-main
$ git rev-parse --abbrev-ref --symbolic-full-name @{u}  → origin/chat-eval-budgets
$ git status -sb                                        → ## chat-eval-main...origin/chat-eval-budgets [ahead 3, behind 1]
$ git ls-remote --heads origin chat-eval-budgets        → (0 lines — branch deleted on the remote)
$ git rev-list --left-right --count origin/main...HEAD  → 2  0     (2 behind, 0 ahead)
```

Against `origin/main` the worktree is a **strict ancestor**: 0 ahead, 2 behind. The
`[ahead 3, behind 1]` is measured only against the stale remote-tracking ref. Retargeting
upstream to `origin/main` and fast-forwarding is a clean, zero-conflict operation.
`scripts/chat-eval/.gitignore` = `reports/`, so accumulated reports are untracked and
will not obstruct it. One untracked file exists in that worktree (`aum-gen.json`) — it is
untracked and does not block a fast-forward.

### Defect 5 — the runner throws away every exit code it collects (CONFIRMED)

`chat-eval-nightly.ps1:8` — `$ErrorActionPreference = 'Continue'`
`chat-eval-nightly.ps1:29-30`:

```powershell
$evalExit = $LASTEXITCODE
Say "eval exit: $evalExit (non-zero = pass rate below CHAT_EVAL_MIN_PASS)"
```

`$evalExit` is captured, logged, and **never tested**. `triage.mjs`'s exit code is not
captured at all. `chat-eval-nightly.ps1:40` says `'=== chat-eval nightly done ==='`
unconditionally and the script always exits 0.

`scripts/chat-eval/run.mjs:246` — `process.exit(fleet.passRate >= MIN_PASS ? 0 : 1)`.
**The harness does exit 1 on a total outage.** The signal reaches the runner and is
discarded there.

Proof of the end state, read live during authoring:

```
TaskName       : Shre-ChatEval
LastRunTime    : 7/23/2026 4:47:01 AM
LastTaskResult : 0
NextRunTime    : 7/24/2026 4:47:00 AM
```

The run in which production was degraded, the eval scored 0/12, and triage died with a
stack trace is recorded by Windows as a **success**.

### The 2026-07-23 timeline (corrected; report directory names are UTC)

From `…/chat-eval-main/scripts/chat-eval/reports/`:

| Run (UTC) | Result | Origin |
|---|---|---|
| `2026-07-23T06:53:41Z` | 12/12 pass, passRate 1.0 | manual |
| `2026-07-23T07:43:49Z` | `error: TimeoutError` | manual |
| `2026-07-23T07:45:23Z` | 5/12, `{transport: 6, must-not-contain: 1}` | manual |
| `2026-07-23T08:47:04Z` | `error: TimeoutError` | **the nightly** — this is the run that ENOENT-crashed triage |
| `2026-07-23T14:44:23Z` | `error: TimeoutError` | manual |
| `2026-07-23T14:48:46Z` | `error: TimeoutError` | manual |
| `2026-07-24T00:17:28Z` | `error: login failed for npatel@rapidrms.com: HTTP 401` | manual — a **different** failure mode |

Only the 08:47Z run came from the scheduled task; the manual runs never appear in
`chat-eval.log`.

**The 07:45Z failures were not login 401s.** Login succeeded and a tenant resolved; six
of twelve `/v1/chat` calls returned 401 per-question (`voids`, `week-compare`, `labor`,
`capabilities`, `off-scope`, `llm-canary`) and were scored `transport: HTTP 401`, while
`sales-today` / `top-items` / `low-stock` / `connectors` / `multi-part` returned 200.
That is mid-run authz flakiness at the chat layer — do not conflate it with the
00:17Z login 401.

### The outage was real, and a second monitor also saw it and also told nobody

`/var/log/platform-health.log` on `aros-vps` shows `readyz=000` (connection failure)
across `mib.shre.ai` / `ellie.shre.ai` / `ellie-advanced.shre.ai` at **07:42–07:44Z on
2026-07-23**, flipping to `503` at 07:45–07:46Z — the same minutes chat-eval's 07:43:49Z
run died with `TimeoutError`. **Two independent monitors both saw the outage and neither
told a human.**

### "The only monitoring that exists" is false — the accurate statement is worse

Read live from `aros-vps` (`crontab -l`, read-only):

```
* * * * * /usr/local/bin/platform-health-cron.sh
*/30 * * * * /usr/local/bin/shadow-keepwarm.sh
*/5  * * * * /usr/local/bin/shadow-watchdog.sh
*/2  * * * * /opt/apps/_watchdog/healbot.sh
*/2  * * * * /opt/shre-run/net-watchdog/net-watchdog.sh
0 2 * * * /root/backup-services.sh
…
```

Monitoring exists. **Nothing pages a human.** Specifically:

- `/usr/local/bin/platform-health-cron.sh:25` — `WEBHOOK="${PLATFORM_ALERT_WEBHOOK:-}"`.
  The crontab line has no env prefix. Verified absent from `/etc/cron.d`,
  `/etc/default`, `/etc/environment`, `/root`, and the crontab itself. So
  `emit()` (line 46) only appends to `/var/log/platform-health.log`.
- `/usr/local/bin/platform-health-cron.sh:22` —
  `DOMAINS=(mib.shre.ai ellie.shre.ai ellie-advanced.shre.ai chat.aros.live storepulse.aros.live)`.
  **`app.aros.live` — the exact host chat-eval targets — is not probed.**
- `nirlab-product-sites-health.service` (systemd timer, runs
  `/opt/regulars-site/check-nirlab-product-sites.mjs`) has **no** `Environment=` /
  `EnvironmentFile=` and no grep hit for sendgrid/webhook/slack/mail. Also log-only.
- `scripts/data-freshness-check.mjs` — the sentinel written for exactly this failure
  class — **is not in the crontab at all** (`crontab -l | grep -c freshness` → `0`).
  It is dead code on the box.

**UNVERIFIED:** `docs/journeys/README.md:52` claims `journey-replay.mjs` "runs daily from
the aros-vps cron next to the seam walk". There is no such crontab entry. That doc claim
has drifted; do not build on it. *Verify by:* `ssh aros-vps 'crontab -l'` (done — no
match) plus `systemctl list-timers --all` (done — no journey-replay unit).

### The house alert contract (copy this shape, do not invent one)

`/usr/local/bin/platform-health-cron.sh:46-51`:

```bash
emit() { # emit <emoji> <text>
  echo "[$TS] $2" >> "$LOG"
  if [ -n "$WEBHOOK" ]; then
    curl -s -o /dev/null --max-time 10 -X POST "$WEBHOOK" \
      -H 'Content-Type: application/json' \
      -d "{\"text\":\"$1 Platform health: $2\"}" || echo "[$TS] WARN: webhook POST failed" >> "$LOG"
```

Two properties to preserve: **Slack-compatible `{"text": "…"}`**, and
**transition-aware** — line 42-43 of that script compares the sorted failing set to
`$STATE_FILE` and alerts only on change. Its own header (line 13, 18) documents that
the script it replaced alarmed every minute and thereby made a real outage invisible in
the noise.

### An email destination already exists (this unblocks the alert lane today)

`aros-vps` `/opt/aros-platform/.env` contains (key names only, values not read):
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SENDGRID_API_KEY`, `EMAIL_FROM`,
`PLATFORM_ADMIN_EMAILS`, …

`scripts/data-freshness-check.mjs:91-136` already uses `SENDGRID_API_KEY` +
`EMAIL_FROM` to email humans, with a **20-hour per-tenant cooldown** kept in a state
file at `/opt/shre-ops/state/data-freshness-mail.json` (line 95) so a persistent failure
emails at most daily. Its contract, from `data-freshness-check.mjs:79-83`:

```js
if (failures.length) {
  for (const f of failures) console.log(f);
  await emailOwners(failures).catch((e) => console.log(`WARN · … · email step failed: ${e.message}`));
  process.exit(1);
}
```

`FAIL · <sentinel> · <reason>` on stdout, best-effort email, exit 1. Staleness threshold
= 2× cadence + 1h grace (`data-freshness-check.mjs:26`, `STALE_HOURS` default 13 for a
6h cadence).

Also present locally: `C:/Users/nirpa/.shre/vault/digest-email.json` with keys
`['sendgrid_api_key', 'from', 'recipients']` (keys enumerated; values not read).

**Therefore: email is a real, already-wired destination. A Slack/Discord webhook is
still preferred but is a founder decision, and the track must not block on it.**

### Reuse inventory (bind to these — do not invent parallel machinery)

- `scripts/chat-eval/triage-core.mjs` — pure, no I/O. `buildTriage(rows)` at line 28;
  `ENGINEERING_FAMILIES` set at lines 5-12 (`empty-reply`, `tool-error`,
  `misroute-sales-template`, `no-comparison`, `tenant-name-missing`, `transport`) —
  **no family exists for "the run itself failed"**; `fingerprint(questionId, family)` at
  line 18 → `chat-eval/${questionId}/${family}`; `planIssueActions(intents, openIssues)`
  at line 85 dedups by a fingerprint regex-matched out of the issue body
  (`/Fingerprint: `([^`]+)`/`, line 88); `buildDigestPayload({summary, operational,
  runMeta})` at line 96 **already receives `summary` including per-workspace `.error`**.
- `scripts/chat-eval/triage-core.test.mjs` — plain `node:test` + `node:assert/strict`,
  header comment line 1 gives the command: `node --test scripts/chat-eval/triage-core.test.mjs`.
- `public.platform_settings` — `supabase/migrations/20260723_platform_settings.sql:9-15`:
  `(key text PRIMARY KEY, value jsonb NOT NULL DEFAULT '{}', updated_at timestamptz NOT NULL DEFAULT now())`,
  `ALTER TABLE … ENABLE ROW LEVEL SECURITY` with **zero policies and no grants** =
  service-role only. Already read by `src/server.ts:330` for the automation global pause.
- `src/server.ts:901` — `function json(res, status, data)`.
- `src/server.ts:1080` — `async function parseJsonBody(req): Promise<Record<string, unknown> | null>`.
- `src/server.ts:3780` — `function tokensMatch(a: string, b: string): boolean` — hashes
  both sides to 32 bytes then `timingSafeEqual`, so no length leak. Use this for any
  shared-secret comparison; do not write `===`.
- `src/server.ts:1120-1142` — `auditLog({tenantId?, userId?, action, resource?, detail?, ip?})`
  → `supabase.from('audit_log').insert(...)`, non-fatal on error.
- Route dispatch shape, `src/server.ts:7099-7104`:
  ```ts
  if (url === '/api/login' && method === 'POST') {
    if (!rateLimit(req, 10, 60_000)) {
      return json(res, 429, { error: 'Too many requests. Please wait.' });
    }
    return handleLogin(req, res);
  }
  ```
- `src/server.ts:866-872` — `createHeartbeatMonitor('aros-platform', { intervalMs: 30_000, publishFn: … })`
  with `registerDependency('cortexdb'|'redis'|'shre-tasks', …)`. In-process liveness for
  the *server*; it cannot observe a Windows scheduled task and is **not** the right host
  for this dead-man's-switch. Named here so you don't spend time rediscovering it.

### The harness is synthetic-only — say so, don't paper over it

`scripts/chat-eval/battery.json` contains exactly **12 fixed questions**:
`sales-today, top-items, low-stock, voids, week-compare, connectors, labor, capabilities,
multi-part, off-scope, llm-canary, heartbeat` (verified by parsing the file: count 12).
One hard-coded workspace. Deterministic string/number assertions in `core.mjs`
(families documented at `scripts/chat-eval/README.md:13-22`). No real user turns.
`--all` fleet mode exists but is deliberately OFF — `chat-eval-nightly.ps1:5-6`:

```
# NOTE: --all (fleet sweep) stays OFF until eval traffic is metering-exempt —
# eval chats are real metered chats and would pollute tenant billing.
```
(corroborated by `scripts/chat-eval/README.md:80-85`).

**A green 12/12 is evidence that the pipes are open, not that chat is good.** Hardening
this watchdog raises confidence in a signal that is narrower than it looks. That
limitation is handed to track F (real-traffic-derived battery); this track must not
attempt to widen the battery.

### Credentials

`C:/Users/nirpa/.shre/secrets/chat-eval.env` — keys `CHAT_EVAL_EMAIL`,
`CHAT_EVAL_PASSWORD`, `CHAT_EVAL_BASE`, `CHAT_EVAL_REPO`. Loaded by
`chat-eval-nightly.ps1:19-21` via a regex loop:

```powershell
Get-Content (Join-Path $env:USERPROFILE '.shre\secrets\chat-eval.env') | ForEach-Object {
  if ($_ -match '^\s*([A-Z_]+)=(.*)$') { Set-Item -Path "env:$($Matches[1])" -Value $Matches[2] }
}
```

The in-file TODO is verbatim:
`# TODO: migrate to OpenBao AppRole pull (vault.aros.live) per vault-first policy.`
File mtime **2026-07-21 23:43, unchanged since creation** — the same bytes produced
12/12 at 2026-07-23T06:53:41Z. **No local rotation happened. Whatever changed, changed
server-side.**

OpenBao tooling present on this box: `bao` CLI at `C:/Users/nirpa/bin/bao`; AppRole
material at `C:/Users/nirpa/.shre/secrets/vault--openbao-role-id.dpapi` and
`vault--openbao-secret-id.dpapi` (262-byte raw binary blobs, i.e. `ProtectedData` output
rather than the PowerShell hex `SecureString` export format).

**UNVERIFIED:** the exact unwrap incantation for those `.dpapi` files. The format is
consistent with
`[System.Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($p), $null, 'CurrentUser')`,
but no existing script on this box demonstrates the convention (`~/.shre/tasks/` contains
only `aum-warmkeeper.ps1`, `billing-probe.ps1`, `chat-eval-nightly.ps1`, none of which
touch DPAPI or `bao`). *Verify by:* running the `Unprotect` one-liner against
`vault--openbao-role-id.dpapi` and checking the result is a UUID — **or ask the founder**
(see Stop conditions).

---

## Depends on / blocks

**Depends on:** nothing. This track is self-contained and must not wait on anything —
including the 401 diagnosis below, which is founder-run and read-only.

**Blocks / hands off to:**

- **Track F (real-traffic eval battery).** This track proves the *delivery* of the
  signal; track F fixes the *narrowness* of it. Hand F: (a) the 12-question inventory
  above, (b) the metering constraint at `chat-eval-nightly.ps1:5-6` and
  `README.md:80-85` that keeps `--all` off, (c) the recommendation at
  `scripts/chat-eval/README.md:84-85` for a dedicated `eval@` member per tenant instead
  of the founder's personal account.
  **HARD ORDERING, RESOLVED 2026-07-24: E → F on `scripts/chat-eval/triage.mjs` and
  `triage-core.mjs`.** This track owns the structural rewrite of those two files
  (steps 1, 3, 4); F's step 4 (`ENGINEERING_FAMILIES`) and step 5 (`FAMILY_UMBRELLA`
  after the `planIssueActions` call at `triage.mjs:61`) rebase on top. F post-processes
  the return value of the very call whose *argument* this track replaces
  (`issues` → `allIntents`), so landing F first would force a rewrite of both. Land
  steps 1–4 promptly — F is blocked behind them. Full table: §Collision warnings →
  Package file-ownership register.

**Soft coupling (sequence, don't merge blind):** any other track editing `src/server.ts`.
This track adds one small route block plus one handler; see Collision warnings.

---

## Data contract

### C1 — `classifyRun(summary)` — new pure function in `triage-core.mjs`

Input is `summary.json` exactly as `run.mjs:244` writes it:

```ts
type WorkspaceSummary = {
  workspace: string;          // email
  tenantId?: string | null;
  name?: string | null;
  error?: string;             // present ONLY when the whole workspace threw
  total: number; pass: number; warn: number; fail: number;
  passRate: number;           // 0..1
  byReason?: Record<string, number>;
};
type RunSummary = { when: string; base: string; workspaces: WorkspaceSummary[]; passRate: number };
```

Output:

```ts
type RunVerdict = {
  status: 'ok' | 'degraded' | 'errored';
  // 'errored'  = EVERY workspace carries .error  (or workspaces is empty) -> no questions ran
  // 'degraded' = some workspaces errored, others produced results
  // 'ok'       = no workspace carries .error (pass rate is NOT this function's business)
  erroredWorkspaces: Array<{ workspace: string; error: string }>;
  totalWorkspaces: number;
  passRate: number;           // echoed from summary.passRate
  fingerprint: string | null; // 'chat-eval/run/errored' when status !== 'ok', else null
  title: string | null;       // 'chat-eval: the eval run itself failed (no questions asked)'
  reason: string | null;      // first error string, trimmed to 200 chars, for the alert line
};
```

**Fingerprint stability is a hard requirement.** It must contain **no timestamp, no error
text, no workspace list** — otherwise consecutive failed nights each open a new GitHub
issue and the alert becomes spam. `chat-eval/run/errored` is a constant. That makes
`planIssueActions` (`triage-core.mjs:85`) file one issue on the first failure and add a
recurrence comment on every subsequent one, matching the existing dedup behaviour
exactly.

### C2 — the run-error issue intent

`classifyRun` must be adaptable into the *same* intent shape `buildTriage` produces, so
`planIssueActions` / `renderIssueBody` / `renderRecurrenceComment` work unchanged:

```ts
type IssueIntent = {
  fingerprint: string;  // 'chat-eval/run/errored'
  family: 'run-error';  // NEW family; do NOT add it to ENGINEERING_FAMILIES (that set
                        // is matched against per-row reason strings; this is not a row)
  questionId: 'run';    // renderIssueBody prints it as `**Question** (\`run\`)`
  question: string;     // 'the eval run itself — no questions were asked'
  title: string;
  workspaces: string[]; // the errored workspace emails
  examples: Array<{ workspace: string; reason: string; reply: string }>; // reason = the error string
};
```

Label set follows the existing call at `triage.mjs:67`:
`[LABEL, `${LABEL}:${intent.family}`]` → `['chat-eval', 'chat-eval:run-error']`.

### C3 — digest payload v2

Extend `buildDigestPayload` (`triage-core.mjs:96`) **additively**. Existing consumers:
none (the lane has never fired), so this is free — but keep the existing keys.

```ts
{
  kind: 'chat-eval',
  when: string,                 // summary.when, ISO
  base: string,                 // e.g. 'https://app.aros.live'
  fleetPassRate: number,        // 0..1
  workspaces: Array<{ workspace, name, pass, total, passRate, error }>,
  operationalSignals: Array<{ workspace, tenantId, questionId, reason }>,
  // NEW:
  runStatus: 'ok' | 'degraded' | 'errored',
  runError: string | null,      // RunVerdict.reason
  laneErrors: string[],         // messages from any lane that failed this pass, e.g.
                                // 'issue-lane: github /repos/…: HTTP 410 …'
  text: string                  // Slack-compatible one-liner, see below
}
```

`text` makes the payload postable to a bare Slack/Discord webhook with no transformer,
matching `platform-health-cron.sh:51`. Format (pure, testable):

- errored: `":rotating_light: chat-eval: run FAILED on <base> — no questions asked (<reason>)"`
- degraded: `":warning: chat-eval: <n>/<m> workspaces errored on <base> (<reason>)"`
- ok with issues: `":warning: chat-eval: pass rate <p>% on <base>, <k> defect intents"`
- ok clean: `":white_check_mark: chat-eval: <p>% pass on <base>"`

### C4 — heartbeat endpoint (new, on the AROS server)

`POST /api/ops/chat-eval-heartbeat`

Request headers: `Content-Type: application/json`, `x-chat-eval-token: <secret>`.
Request body:

```ts
{
  when: string;                      // ISO timestamp of the run
  base: string;                      // target the harness evaluated
  runStatus: 'ok' | 'degraded' | 'errored';
  passRate: number;                  // 0..1
  evalExit: number;                  // run.mjs exit code
  triageExit: number;                // triage.mjs exit code
  reason?: string | null;            // first error, ≤200 chars
}
```

Responses:

| Status | Body | When |
|---|---|---|
| 200 | `{ ok: true, key: 'chat_eval_last_run' }` | written |
| 400 | `{ error: 'Invalid JSON' }` / `{ error: 'when and runStatus are required' }` | bad body |
| 401 | `{ error: 'Unauthorized' }` | token missing/mismatched, or `CHAT_EVAL_HEARTBEAT_SECRET` unset on the server |
| 429 | `{ error: 'Too many requests. Please wait.' }` | `rateLimit(req, 10, 60_000)` |

**No tenant data crosses this boundary. No PAN, no email, no token is ever echoed back
or logged.** `reason` may contain an error string from the harness — truncate to 200
chars and do not log it at `info` level.

Why an endpoint and not a direct Supabase write from Windows: `run.mjs:74` and
`scripts/chat-eval/README.md:83-85` establish that `SUPABASE_SERVICE_ROLE_KEY` stays on
the VPS. Shipping the prod service-role key to a workstation to write one watermark row
is a security regression; a single-purpose write-only shared secret is not.

### C5 — the watermark row

Stored in the existing `public.platform_settings` table. **No schema change is needed** —
the table and its RLS enablement already exist at
`supabase/migrations/20260723_platform_settings.sql:9-15` (`CREATE TABLE`) and `:15`
(`ALTER TABLE … ENABLE ROW LEVEL SECURITY`).

> **CORRECTED 2026-07-24 — do NOT repeat the `CREATE TABLE` here.**
> The first draft of this migration restated the full `CREATE TABLE IF NOT EXISTS
> public.platform_settings (…)` plus the `ALTER … ENABLE ROW LEVEL SECURITY`, calling it
> "documentation-only, idempotent". It is safe *today*, but it leaves **two `CREATE TABLE`
> statements for one table in two files**. `scripts/check-migration-safety.mjs`
> concatenates every migration and only checks that *some* file enables RLS for each
> created table (`:25-40`), so it would never flag a divergence — if either copy is later
> edited (a column added, a type changed) the repo has two sources of truth and nothing
> catches it. That is the exact silent-no-op failure mode the `entity_note` finding
> (briefs G/H) is about, and it costs nothing to avoid here.
>
> **Keep: the header comment, the `REVOKE`, and the seed `INSERT … ON CONFLICT DO NOTHING`.
> Drop: the `CREATE TABLE` and the `ALTER … ENABLE ROW LEVEL SECURITY`.** Cite
> `20260723_platform_settings.sql:9-15` instead. The house rule "RLS ships in the same
> migration as the table" is satisfied by that file — this migration creates no table, so
> the rule does not apply to it, and `pnpm check:migrations` stays green either way
> (verified: the checker scans the concatenated set, and `20260723` carries both the
> `CREATE TABLE` and the `ENABLE ROW LEVEL SECURITY`).
>
> The `REVOKE` is **not** redundant and must stay: `20260723_platform_settings.sql` has
> **no `REVOKE`**, and this repo's other migrations defend against Supabase's default
> privileges explicitly (`20260716_oidc_rp_sessions.sql:17`,
> `20260717_terms_acceptances.sql:57`, `20260717_public_commerce.sql:96-98`). Adding it
> here is a real hardening, not documentation.

Ship a *seed-and-harden* migration so the row's meaning is discoverable and the
service-role-only posture is enforced rather than assumed:

```sql
-- supabase/migrations/20260724_chat_eval_heartbeat.sql
--
-- Dead-man's-switch watermark for the nightly chat-eval harness
-- (docs/briefs/e-watchdog-unsilence.md). The Windows runner POSTs
-- /api/ops/chat-eval-heartbeat after EVERY run, success or failure; the server
-- upserts this row with its own service-role client. An off-box sentinel on
-- aros-vps reads it and alerts when it goes stale — that is how "the run did
-- not happen at all" becomes visible.
--
-- value shape:
--   { "when": "2026-07-24T08:47:04.198Z", "base": "https://app.aros.live",
--     "runStatus": "ok"|"degraded"|"errored", "passRate": 1.0,
--     "evalExit": 0, "triageExit": 0, "reason": null }

-- The table itself is NOT declared here. It is created, with RLS enabled, in
-- supabase/migrations/20260723_platform_settings.sql:9-15. Re-declaring it would
-- put two CREATE TABLE statements for one table in two files, and
-- scripts/check-migration-safety.mjs (which scans the concatenated set) would not
-- notice if they ever diverged. One table, one DDL, one file.
--
-- What IS added here: the missing grant defence. 20260723 enables RLS but issues no
-- REVOKE, and this repo defends against Supabase's default privileges explicitly
-- elsewhere (20260716_oidc_rp_sessions.sql:17, 20260717_terms_acceptances.sql:57).
-- RLS ON + ZERO policies + no grants to anon/authenticated => service-role only.
REVOKE ALL ON public.platform_settings FROM anon, authenticated;

-- Seed a sentinel-legible row so the freshness check has something to read on a
-- cluster that has never run the harness. 'never' is deliberately stale.
INSERT INTO public.platform_settings (key, value)
VALUES ('chat_eval_last_run', '{"runStatus":"never","when":null}'::jsonb)
ON CONFLICT (key) DO NOTHING;
```

Run `pnpm check:migrations` (`package.json` → `"check:migrations": "node scripts/check-migration-safety.mjs"`)
before proposing it.

### C6 — the off-box sentinel output contract

`scripts/chat-eval-freshness.mjs`, a sibling of `scripts/data-freshness-check.mjs`,
copying its contract verbatim:

- reads `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` from the environment; missing ⇒
  `FAIL · chat-eval-freshness · SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set`, exit 1
  (mirrors `data-freshness-check.mjs:28-31`)
- `GET {url}/rest/v1/platform_settings?key=eq.chat_eval_last_run&select=value,updated_at`
- staleness threshold = **2× cadence + 1h grace = 49h** for a 24h cadence
  (`CHAT_EVAL_STALE_HOURS`, default 49) — same arithmetic as
  `data-freshness-check.mjs:26`
- stdout lines, one per condition:
  - `OK · chat-eval-freshness · last run <n.n>h ago, status ok`
  - `FAIL · chat-eval-freshness · no heartbeat row — the runner has never reported`
  - `FAIL · chat-eval-freshness · last run was <n.n>h ago (limit 49h) — the nightly did not run`
  - `FAIL · chat-eval-freshness · last run reported status=errored (<reason>) at <when>`
- exit 1 if any FAIL, else 0
- **transition-aware alerting**: keep a state file at
  `/opt/shre-ops/state/chat-eval-freshness.json` holding
  `{ lastState: string, lastNotifiedAt: number }`. Emit an alert **only when the sorted
  FAIL set differs from `lastState`**, plus a re-notify floor of 20h (the cooldown
  `data-freshness-check.mjs:106` uses). This is the single most important property in the
  track — see Risks in "Stop conditions" and Collision warnings.

---

## Implementation steps

Steps 0, 1-4, and 8 are independent and may run in parallel. Steps 5-7 depend on 1-4.

### Step 0 — Founder-run 401 diagnosis (read-only; blocks nothing; **you do not do this**)

**Do NOT attempt a login. Do NOT run the eval to "test" the credentials.**
`src/server.ts:1176-1189` implements a progressive in-memory lockout
(5 fails → 1 min, 10 → 5 min, 15 → 15 min, 20+ → 1 hr, keyed `email:ip`), and repeated
attempts also feed the very GoTrue rate-limit that hypothesis H2 posits — retrying would
*manufacture* the evidence and destroy the ability to tell H1 from H2. The account in
question is the founder's own login to `app.aros.live`.

Established, read-only facts:

1. `app.aros.live/readyz` returned **200** during authoring. Prod is serving; the 401 is
   not an outage artifact.
2. `src/server.ts:2411` — the AROS brute-force lockout returns **429**, not 401.
   The observed 401 therefore **rules out the AROS-side lockout**.
3. `src/server.ts:2429-2437` — `if (error || !data.session)` → `json(res, 401, { error:
   'Invalid email or password' })`. **Every** Supabase auth error — wrong password,
   banned user, GoTrue 429 — is flattened into one indistinguishable 401 ("Generic
   message — don't reveal whether email exists", line 2436). The 401 is ambiguous *by
   design*; only server-side logs discriminate.
4. Local creds unchanged since 2026-07-21 23:43 and proven working at 2026-07-23T06:53:41Z.
5. The earlier failures were `TimeoutError` under a corroborated load event; the 401 is a
   **new, distinct** mode appearing only after prod recovered. Rate-limit residue decays;
   a credential or user-state change does not.

**Ranking: H1 > H2 > H3.**

**H1 — server-side credential / user-state change (most likely).** Prod Supabase SQL
editor, read-only:

```sql
select id, email, created_at, updated_at, last_sign_in_at,
       email_confirmed_at, banned_until
from auth.users
where lower(email) = 'npatel@rapidrms.com';
```

*Decisive if:* `updated_at > '2026-07-23T06:53:41Z'` (record mutated after the last good
eval), **or** `banned_until` is non-null, **or** `last_sign_in_at` shows a browser sign-in
after `2026-07-24T00:17:28Z` (the account works; only the stored eval password is stale).
Remedy: set the eval password deliberately and land it in OpenBao — **not** back into the
flat `.env`.

**H2 — GoTrue rate-limit flattened to 401.** Two reads:

```sql
select created_at, action, ip, detail
from public.audit_log
where action in ('auth.login_failed','auth.login_locked','auth.login_success')
  and detail->>'email' = 'npatel@rapidrms.com'
  and created_at >= '2026-07-23T00:00:00Z'
order by created_at desc
limit 50;
```

(The writer is `auditLog()` at `src/server.ts:1120-1142`; `auth.login_failed` is emitted
at `src/server.ts:2431-2435`, `auth.login_locked` at `src/server.ts:2406-2410`,
`auth.login_success` at `src/server.ts:2442-2444`.)

Then Supabase Dashboard → Logs → **Auth**, filtered to `POST /token?grant_type=password`
around `2026-07-24T00:17:28Z`.

*Decisive if:* GoTrue shows **429 / `over_request_rate_limit`** → H2 confirmed; wait the
window out, do not retry. If GoTrue shows **400 `invalid_grant` /
`invalid_login_credentials`** → that is H1, not H2. An `auth.login_locked` row would mean
the AROS lockout fired — but that path returns 429, so its presence alongside an observed
401 would indicate a *second caller*, not this one.

**H3 — genuine platform-wide auth regression (least likely).**

```sql
select count(*) as successes, max(created_at) as latest
from public.audit_log
where action = 'auth.login_success'
  and created_at >= '2026-07-23T06:53:41Z';
```

*Decisive if:* **zero** successes for any user since the last good eval → platform-wide
auth regression; escalate immediately. Any other user signing in successfully → prod auth
is healthy and the fault is account-scoped (fall back to H1/H2).
Prior art: the comment at `src/server.ts:2418-2423` documents an RLS-possessed admin
singleton that previously caused "fleet-wide 401s once the stale session expired". The six
`/v1/chat` 401s at 2026-07-23T07:45Z on a *successfully authenticated* session are a soft
match for that signature — noted, out of scope for this track, flagged to the founder.

### Step 1 — `classifyRun` as a pure function (`scripts/chat-eval/triage-core.mjs`)

Add, near `buildTriage` (line 28) and **without modifying** `ENGINEERING_FAMILIES`
(lines 5-12) or `buildTriage` itself:

- `export function classifyRun(summary)` → `RunVerdict` (contract C1).
  Rules, as declarative data where possible:
  - `workspaces` empty or every entry has a truthy `.error` ⇒ `'errored'`
  - some entries have `.error`, some don't ⇒ `'degraded'`
  - no `.error` ⇒ `'ok'`
  - `fingerprint` = `'chat-eval/run/errored'` when status ≠ `'ok'`, else `null`
- `export function runErrorIntent(verdict)` → `IssueIntent | null` (contract C2);
  returns `null` when `verdict.status === 'ok'`.
- `export function digestText({ verdict, issues, summary })` → the `text` string
  (contract C3). Pure; no emoji lookup tables beyond a frozen literal map.

No I/O in this file. No imports beyond what it already has (it has none).

### Step 2 — tests for step 1 (`scripts/chat-eval/triage-core.test.mjs`)

Append to the existing file, matching its style (`node:test` + `assert/strict`). Use the
**real** fixtures captured above — copy them verbatim as literals:

- `ERRORED_SUMMARY` = the `2026-07-23T08-47-04` summary (TimeoutError, passRate 0)
- `LOGIN_401_SUMMARY` = the `2026-07-24T00-17-28` summary
  (`"error": "Error: login failed for npatel@rapidrms.com: HTTP 401"`)
- `OK_SUMMARY` = `{ when, base, workspaces: [{ workspace, total: 12, pass: 12, fail: 0, passRate: 1 }], passRate: 1 }`
- `DEGRADED_SUMMARY` = two workspaces, one with `.error`, one with `passRate: 0.58`

Assertions:
1. `classifyRun(ERRORED_SUMMARY).status === 'errored'` and `.reason` contains `TimeoutError`
2. `classifyRun(LOGIN_401_SUMMARY).status === 'errored'` and `.reason` contains `HTTP 401`
3. `classifyRun(OK_SUMMARY).status === 'ok'` and `.fingerprint === null`
4. `classifyRun(DEGRADED_SUMMARY).status === 'degraded'`
5. **Fingerprint stability:** `classifyRun(ERRORED_SUMMARY).fingerprint ===
   classifyRun(LOGIN_401_SUMMARY).fingerprint` — different errors, different nights, one
   issue. This is the anti-spam guarantee; assert it explicitly.
6. `planIssueActions([runErrorIntent(classifyRun(ERRORED_SUMMARY))], [{ number: 7, title:
   'x', body: renderIssueBody(runErrorIntent(classifyRun(LOGIN_401_SUMMARY)), {when:'a',
   base:'b'}) }])` → `[{ action: 'comment', number: 7 }]`. Proves the existing dedup
   machinery (`triage-core.mjs:85-94`) picks the run-error fingerprint out of a rendered
   body with no change to `planIssueActions`.
7. `digestText` returns the `:rotating_light:` variant for `'errored'`.

### Step 3 — make the triage shell survive a missing `results.jsonl` (`scripts/chat-eval/triage.mjs`)

Replace line 36 so `results.jsonl` is optional:

```js
import { readFileSync, readdirSync, existsSync } from 'fs';           // line 13: add existsSync
…
const summary = JSON.parse(readFileSync(join(runDir, 'summary.json'), 'utf8'));   // unchanged (35)
const rowsPath = join(runDir, 'results.jsonl');
const rows = existsSync(rowsPath)
  ? readFileSync(rowsPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
  : [];
const runMeta = { when: summary.when, base: summary.base };
const verdict = classifyRun(summary);
const { issues, operational } = buildTriage(rows);
const allIntents = [...(runErrorIntent(verdict) ? [runErrorIntent(verdict)] : []), ...issues];
```

Add `classifyRun, runErrorIntent, digestText` to the import on line 16.

**Replace `issues` with `allIntents` at ALL THREE of its uses in the issue lane — not two:**
1. the `if (!issues.length)` guard at line 55;
2. the `planIssueActions(issues, openIssues)` call at line 61;
3. **the interpolated count in the no-token warning at line 58** —
   `` console.warn(`[triage] GITHUB_TOKEN not set — skipping issue lane (${issues.length} intents)`) ``
   must become `${allIntents.length}`.

(3) is easy to miss and is load-bearing: Acceptance **A2 criterion 2** reads exactly that
count as its proof that the run-error intent reached the lane. Leave it on `issues.length`
and the line prints `(0 intents)` on a run with a real run-error intent — the watchdog is
fixed but still reports silence, which is the class of defect this whole track exists to
kill.

Reviewer grep: `grep -n "issues" scripts/chat-eval/triage.mjs` — after this step the only
surviving references should be the destructure on the `buildTriage` line and `openIssues`.

Note for the reviewer: with `rows = []`, `buildTriage([])` returns
`{ issues: [], operational: [] }` — verified by reading `triage-core.mjs:28-58` (the loop
body never executes). No further guard is needed.

### Step 4 — make the two lanes independent and the exit code truthful (`scripts/chat-eval/triage.mjs`)

1. Wrap the whole issue lane (lines 54-79) in `try { … } catch (e) { laneErrors.push(\`issue-lane: ${e.message}\`); }`.
   The `gh()` throw at line 50 stays — it is a correct low-level signal; what changes is
   that it no longer takes the process with it.
2. Wrap the digest lane (lines 82-98) in its own `try/catch` → `laneErrors.push(\`digest-lane: …\`)`.
3. Also treat a non-2xx digest POST as a lane error: line 94 currently only logs
   `HTTP ${res.status}`; add `if (!res.ok) laneErrors.push(...)`.
4. Pass `verdict` and `laneErrors` into `buildDigestPayload` and extend that pure function
   per contract C3 (`triage-core.mjs:96-105`).
5. At the end, after the existing summary log at line 100:

```js
if (laneErrors.length) for (const e of laneErrors) console.error(`[triage] LANE FAILURE ${e}`);
process.exit(verdict.status !== 'ok' || laneErrors.length ? 1 : 0);
```

`triage.mjs` currently has no explicit exit; adding one makes its failure observable to
the runner. **Note the ordering requirement:** the digest lane must run even when the
issue lane threw — that is the whole point of step 4 — so build the payload *after* both
lanes and POST it inside the digest lane's own try.

6. **Write `verdict.json` here — this step owns it.** Immediately before the
   `process.exit(...)` above, persist the verdict so the freshness sentinel (Step 7.4)
   and the dead-man's-switch have a file to read. Without this the sentinel has nothing
   to check and the whole un-silencing is inert:

```js
writeFileSync(join(runDir, 'verdict.json'), JSON.stringify({ ...verdict, laneErrors }, null, 2));
```

   `runDir` is the report directory this run already writes into; import `writeFileSync`
   from `node:fs` and `join` from `node:path` if not already imported. **The consuming
   contract and its exact field expectations are specified ~140 lines below in the
   warning box under Step 7.4 — read that box before writing this line**, because the
   sentinel treats a missing or malformed `verdict.json` as a hard failure. This forward
   pointer exists because a sequential executor would otherwise complete Step 4 without
   knowing Step 7.4 depends on it.

### Step 5 — the heartbeat endpoint (`src/server.ts`) — **smallest possible diff**

Two additions, nothing else:

(a) A handler placed immediately before `handleLogin` (`src/server.ts:2390`):

```ts
// ── chat-eval dead-man's-switch watermark ───────────────────────
// The nightly harness (scripts/chat-eval, runner: ~/.shre/tasks/chat-eval-nightly.ps1)
// POSTs here after EVERY run, pass or fail. An off-box sentinel on aros-vps reads the
// row and alerts when it goes stale — that is how "the run never happened" is detected.
// Write-only, no tenant data, shared-secret gated (the service-role key stays on the VPS).
async function handleChatEvalHeartbeat(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const secret = process.env.CHAT_EVAL_HEARTBEAT_SECRET || '';
  const presented = String(req.headers['x-chat-eval-token'] || '');
  if (!secret || !tokensMatch(secret, presented)) return json(res, 401, { error: 'Unauthorized' });

  const body = await parseJsonBody(req);
  if (!body) return json(res, 400, { error: 'Invalid JSON' });
  const { when, base, runStatus, passRate, evalExit, triageExit, reason } = body as Record<string, unknown>;
  if (typeof when !== 'string' || typeof runStatus !== 'string') {
    return json(res, 400, { error: 'when and runStatus are required' });
  }

  const value = {
    when,
    base: typeof base === 'string' ? base : null,
    runStatus,
    passRate: typeof passRate === 'number' ? passRate : null,
    evalExit: typeof evalExit === 'number' ? evalExit : null,
    triageExit: typeof triageExit === 'number' ? triageExit : null,
    reason: typeof reason === 'string' ? reason.slice(0, 200) : null,
  };

  const supabase = createSupabaseAdmin();
  const { error } = await supabase.from('platform_settings')
    .upsert({ key: 'chat_eval_last_run', value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) {
    console.error('[chat-eval-heartbeat] write failed:', error.message);
    return json(res, 500, { error: 'Heartbeat write failed' });
  }
  await auditLog({ action: 'ops.chat_eval_heartbeat', resource: 'chat_eval_last_run', detail: { runStatus, when } });
  return json(res, 200, { ok: true, key: 'chat_eval_last_run' });
}
```

`tokensMatch` is at `src/server.ts:3780`; `parseJsonBody` at `1080`; `json` at `901`;
`auditLog` at `1120`; `createSupabaseAdmin` is the same factory used at
`src/server.ts:1129` and `src/server.ts:330`.

(b) The route, immediately after the `/api/login` block (`src/server.ts:7104`), copying
its exact shape:

```ts
  // ── chat-eval dead-man's-switch heartbeat (shared-secret gated) ─
  if (url === '/api/ops/chat-eval-heartbeat' && method === 'POST') {
    if (!rateLimit(req, 10, 60_000)) {
      return json(res, 429, { error: 'Too many requests. Please wait.' });
    }
    return handleChatEvalHeartbeat(req, res);
  }
```

Do not touch anything else in `src/server.ts`. See Collision warnings.

### Step 6 — the off-box sentinel (`scripts/chat-eval-freshness.mjs`)

New file, sibling of `scripts/data-freshness-check.mjs`, implementing contract C6. Copy
its structure literally: header comment explaining the incident that motivated it, the
`rest()` helper (`data-freshness-check.mjs:33-39`), `FAIL · … · …` stdout lines, exit 1,
and the SendGrid best-effort mail step with a state-file cooldown
(`data-freshness-check.mjs:91-136`).

Two deliberate differences from its sibling:
- recipients come from `PLATFORM_ALERT_EMAILS` (comma-separated), falling back to
  `PLATFORM_ADMIN_EMAILS` — both verified present in `/opt/aros-platform/.env`. This is
  **not** a per-tenant notification, so do not reuse the `notification_preferences`
  lookup at `data-freshness-check.mjs:107-120`.
- transition-awareness: alert on FAIL-set *change* plus a 20h re-notify floor. A
  multi-day outage must page **once**, not once per cron tick — the failure mode
  documented in `platform-health-cron.sh:13,18`.

Also POST to `PLATFORM_ALERT_WEBHOOK` when set, using the house payload
`{"text": "..."}` (`platform-health-cron.sh:51`). Absent ⇒ email only ⇒ still a real
destination. **Do not invent a payload shape.**

### Step 7 — runner hardening (`C:/Users/nirpa/.shre/tasks/chat-eval-nightly.ps1`)

This file is **not in any repo**. Before editing, copy it to
`C:/Users/nirpa/.shre/tasks/chat-eval-nightly.ps1.bak-20260724` — that copy is the
rollback. Then, in order:

1. **Fix the upstream (one-time, from inside the worktree, refs-only):**
   ```powershell
   git -C C:\Users\nirpa\.shre\worktrees\aros\chat-eval-main branch --set-upstream-to=origin/main chat-eval-main
   git -C C:\Users\nirpa\.shre\worktrees\aros\chat-eval-main pull --ff-only
   ```
   Verified safe: the worktree is 0 ahead / 2 behind `origin/main`. **Never** run
   `checkout`, `switch`, `rebase`, `reset`, or `merge` there — it shares `.git` with the
   primary checkout `C:/Users/nirpa/Documents/Projects/aros`, which concurrent sessions
   have on `feat/chat-first-redesign`.
2. **Make the pull fatal.** Replace line 25:
   ```powershell
   $pullOut = git pull --ff-only 2>&1
   $pullOut | Add-Content $Log
   if ($LASTEXITCODE -ne 0) { Say "FATAL: git pull --ff-only failed ($LASTEXITCODE) - refusing to run stale code"; $script:fatal = 'stale-worktree' }
   ```
   Running stale code and reporting on it is worse than not running: it produces
   confident results about a build nobody shipped.
3. **Capture both exit codes.** Keep `$evalExit = $LASTEXITCODE` (line 29); add
   `$triageExit = $LASTEXITCODE` immediately after the `node …\triage.mjs` call (line 35),
   and set `$triageExit = 90` in the `else` branch where `gh auth token` is unavailable
   (line 37) so "no token" is not silently a success.
4. **Send the heartbeat, always** — in a `finally`-equivalent position so it fires on the
   fatal path too:
   ```powershell
   $hb = @{ when = (Get-Date).ToUniversalTime().ToString('o'); base = $env:CHAT_EVAL_BASE;
            runStatus = $runStatus; passRate = $passRate; evalExit = $evalExit;
            triageExit = $triageExit; reason = $reason } | ConvertTo-Json -Compress
   try {
     Invoke-RestMethod -Method Post -Uri "$($env:CHAT_EVAL_BASE)/api/ops/chat-eval-heartbeat" `
       -Headers @{ 'x-chat-eval-token' = $env:CHAT_EVAL_HEARTBEAT_SECRET } `
       -ContentType 'application/json' -Body $hb -TimeoutSec 20 | Out-Null
     Say 'heartbeat posted'
   } catch { Say "WARN: heartbeat POST failed: $($_.Exception.Message)" }
   ```
   Derive `$runStatus` from the last run's `summary.json` (read the newest directory under
   `scripts\chat-eval\reports\`) — or, simpler and preferred, have `triage.mjs` write a
   one-line `verdict.json` (`{status, reason, passRate}`) next to `summary.json` and read
   that. Choose the `verdict.json` route; it keeps the classification in one pure place.
   > **⚠️ THE WRITE IS MISSING FROM THIS BRIEF — add it to Step 4, not here.** Step 4
   > already computes `const verdict = classifyRun(summary)` in `triage.mjs`, but no step
   > writes it to disk, so as written this runner reads a file nothing creates and
   > silently falls back to re-deriving the status from `summary.json` — the duplicate
   > classification this track exists to remove. **Do this:** in Step 4, immediately after
   > `classifyRun(summary)`, `writeFileSync(join(runDir, 'verdict.json'), JSON.stringify(verdict))`
   > on **every** path, including the failure path (a run that errored is exactly when the
   > runner needs it). Then this step does nothing but *read* it. It is a `triage.mjs`
   > change, not a runner change — `chat-eval-nightly.ps1` lives in no repo and may only
   > be proposed. See README § Brief defects, track E.
5. **Propagate the exit code.** Replace line 40:
   ```powershell
   $final = if ($script:fatal) { 2 } elseif ($triageExit -ne 0) { $triageExit } elseif ($evalExit -ne 0) { $evalExit } else { 0 }
   Say "=== chat-eval nightly done (exit $final) ==="
   exit $final
   ```
   **This alone changes nothing user-visible** — nobody reads Task Scheduler results. It
   matters only because it feeds step 6's watermark. Do not treat step 7.5 as the fix.
6. **OpenBao migration — ADD the vault path, do not remove anything.** *(Codex may do
   this half only.)* Leave the plaintext load at lines 19-21 in place and put the `bao`
   pull **in front of it**, with an explicit, loudly-logged fallback. Include the two new
   keys in the same secret:
   ```powershell
   $env:VAULT_ADDR = 'https://vault.aros.live'
   # AppRole: role-id/secret-id unwrapped from the DPAPI blobs in ~/.shre/secrets
   # (vault--openbao-role-id.dpapi / vault--openbao-secret-id.dpapi)
   $ok = $false
   try {
     $env:VAULT_TOKEN = (& C:\Users\nirpa\bin\bao write -field=token auth/approle/login role_id=$roleId secret_id=$secretId)
     $sec = & C:\Users\nirpa\bin\bao kv get -format=json <KV_PATH>/chat-eval | ConvertFrom-Json
     # keys: CHAT_EVAL_EMAIL, CHAT_EVAL_PASSWORD, CHAT_EVAL_BASE, CHAT_EVAL_REPO,
     #       CHAT_EVAL_DIGEST_URL, CHAT_EVAL_HEARTBEAT_SECRET
     if ($sec) { <set env from $sec>; $ok = $true; Say 'secrets loaded from vault' }
   } catch { $ok = $false }
   if (-not $ok) { Say 'WARN: vault pull failed - falling back to chat-eval.env'; <existing lines 19-21 loader> }
   ```
   `<KV_PATH>` is **not known** — do not guess one and do not `bao kv put` under a guessed
   path. See Stop conditions Q1. The `.dpapi` unwrap convention is equally **UNVERIFIED**
   (Q2). If either is unresolved when you reach this item, ship the fallback loader
   unchanged and stop here: a runner that still reads the file is exactly today's
   behaviour, i.e. no regression.

   **HARD RULE — you may not delete, move, rename, truncate, re-key or overwrite
   `C:/Users/nirpa/.shre/secrets/chat-eval.env`, and you may not write a new value into
   it.** It is the last known-good copy of a credential nobody can currently re-mint: the
   stored password returned HTTP 401 at `2026-07-24T00:17:28Z` (timeline above), step 0
   has not yet said why, and **the founder cannot log in to re-issue it**. Destroying it
   before the vault path has proven itself is unrecoverable — you would have neither a
   working credential nor the string needed to diagnose which of H1/H2/H3 is true.
   A *logged* dual path for a bounded window is the correct shape here and matches
   Rollback item 8; a *silent* dual path is not, which is why the fallback must `Say`.

7. **[FOUNDER-EXECUTED — not Codex] Retire the plaintext file.** Only after **all** of:
   (a) Stop conditions Q1 + Q2 answered; (b) step 0's 401 diagnosis closed and a
   deliberately-set eval password stored in OpenBao; (c) **at least three consecutive
   scheduled nightly runs** completed with `secrets loaded from vault` in the log and
   **zero** `WARN: vault pull failed` lines. Then, the founder — not the executor — runs:
   ```powershell
   # keep an offline copy first; do not skip this line
   Copy-Item C:\Users\nirpa\.shre\secrets\chat-eval.env `
             C:\Users\nirpa\.shre\secrets\chat-eval.env.retired-20260724 -Force
   Remove-Item C:\Users\nirpa\.shre\secrets\chat-eval.env
   ```
   and then removes the fallback branch from the runner in a follow-up edit. Until that
   happens the dual path stays. **Nothing in this track is allowed to run either line.**

### Step 8 — schedule the sentinel on aros-vps (**founder-executed; you may only propose it**)

Proposed crontab addition, in the box's existing style (see the verified `crontab -l`
above). The nightly harness fires at 08:47 UTC; schedule the check at **10:30 UTC**,
~1h45m later, so a slow-but-successful run is never flagged as missing:

```
30 10 * * * cd /opt/aros-platform && set -a && . ./.env && set +a && \
  node scripts/chat-eval-freshness.mjs >> /var/log/chat-eval-freshness.log 2>&1
```

Note for the founder while they are in there: `scripts/data-freshness-check.mjs` is on the
box and **is not scheduled at all** (`crontab -l | grep -c freshness` → 0). It is dead
code today. Scheduling it is a one-line, high-value freebie — but it is outside this
track's scope and is the founder's call.

**Do not run `crontab -e` yourself. Do not deploy. Do not restart pm2.**
`/opt/aros-platform` is on branch `live/direct-deploy` — a hand-managed fork, not `main`.
Node on that box is v20.20.2, so the sentinel must not use APIs newer than Node 20.

---

## Acceptance tests

### A1 — pure unit tests (no network, no DB)

```bash
cd C:/Users/nirpa/.shre/worktrees/aros/chat-observability
node --test scripts/chat-eval/triage-core.test.mjs
```

Must pass all pre-existing tests (`triage-core.test.mjs:13,23,33`) plus the seven new
assertions from step 2. The fingerprint-stability assertion (#5) is the one a reviewer
should look for by name.

### A2 — replay the real outage against the fixed triage (the regression that matters)

```bash
cd C:/Users/nirpa/.shre/worktrees/aros/chat-observability
mkdir -p /tmp/ce/2026-07-23T08-47-04
cat > /tmp/ce/2026-07-23T08-47-04/summary.json <<'JSON'
{"when":"2026-07-23T08:47:04.198Z","base":"https://app.aros.live","workspaces":[{"workspace":"npatel@rapidrms.com","error":"TimeoutError: The operation was aborted due to timeout","total":0,"pass":0,"warn":0,"fail":0,"passRate":0}],"passRate":0}
JSON
node scripts/chat-eval/triage.mjs --run /tmp/ce/2026-07-23T08-47-04 --dry-run; echo "exit=$?"
```

**Pass criteria — all four:**
1. No `ENOENT` and no stack trace (today this exact input crashes at `triage.mjs:36:14`).
2. stdout contains **`[triage] GITHUB_TOKEN not set — skipping issue lane (1 intents)`**.
   The count going **0 → 1** is the proof that the run-error intent reached the issue lane.

   > **CORRECTED 2026-07-24 — the previous criterion could not be produced by this command.**
   > It asked for `would CREATE: chat-eval: the eval run itself failed`, but this command
   > sets no `GITHUB_TOKEN`. Verified in `scripts/chat-eval/triage.mjs:55-64`: the
   > `!TOKEN` branch at `:57-58` prints
   > `` `[triage] GITHUB_TOKEN not set — skipping issue lane (${issues.length} intents)` ``
   > and returns. `would CREATE` only exists at `:64`, inside the `else` branch, which first
   > calls `gh('/repos/.../issues?labels=chat-eval&state=open&per_page=100')` — needing a
   > valid token **and** network. So A2 as written failed against a *correct*
   > implementation. This criterion tests the same thing (intent count reached the lane)
   > with no token and no network.
   >
   > **If you want the literal `would CREATE` line**, that is a separate, optional check:
   > re-run with `GITHUB_TOKEN=<a read-only PAT>` and network available, and expect
   > `[triage] would CREATE: chat-eval: the eval run itself failed`. Do **not** make it a
   > merge gate — it is network-dependent and the offline form above proves the regression.
   >
   > Note the count in this criterion is **`1 intents`**, not `0`: `buildTriage([])` returns
   > no issues (`rows` is empty — there is no `results.jsonl` in the fixture), so the single
   > intent counted is exactly the new `runErrorIntent(verdict)` from step 3. That is the
   > whole defect being regression-tested.
3. stdout shows the digest lane was reached — `CHAT_EVAL_DIGEST_URL not set — digest lane
   skipped` is acceptable here; the point is that execution got past line 82.
4. `exit=1`.

Then re-run with a real directory that has no `summary.json` either — it should fail with
a clear message, not a bare `ENOENT`.

### A3 — lane independence

```bash
GITHUB_TOKEN=ghp_definitely_invalid CHAT_EVAL_DIGEST_URL=https://httpbin.org/status/200 \
  node scripts/chat-eval/triage.mjs --run /tmp/ce/2026-07-23T08-47-04; echo "exit=$?"
```

The GitHub call must fail (401 from api.github.com), `[triage] LANE FAILURE issue-lane: …`
must print, **the digest POST must still happen** (`[triage] digest POST -> HTTP 200`),
and `exit=1`. Today this input dies at `triage.mjs:50` before line 82 — that is the
2026-07-21 incident at `chat-eval.log:18` reproduced.

### A4 — heartbeat endpoint auth (negative first)

Against a **local** server (`npx tsx src/server.ts`, port 5457 per `CLAUDE.md`), never
against prod for the negative cases:

```bash
# no token -> 401
curl -si -X POST localhost:5457/api/ops/chat-eval-heartbeat \
  -H 'Content-Type: application/json' -d '{"when":"2026-07-24T08:47:00Z","runStatus":"ok"}' | head -1
# wrong token -> 401
curl -si -X POST localhost:5457/api/ops/chat-eval-heartbeat -H 'x-chat-eval-token: wrong' \
  -H 'Content-Type: application/json' -d '{"when":"2026-07-24T08:47:00Z","runStatus":"ok"}' | head -1
# correct token, bad body -> 400
CHAT_EVAL_HEARTBEAT_SECRET=testsecret … -d '{}' | head -1
# correct token, good body -> 200 {"ok":true,"key":"chat_eval_last_run"}
```

Assert the 401 body is exactly `{"error":"Unauthorized"}` and **never** echoes the
presented token.

### A5 — RLS negative test on the watermark (required: this touches the DB)

`platform_settings` must remain unreachable to any non-service-role caller. Against a
local/beta Supabase — **never** prod:

```bash
# anon key: must return zero rows (RLS enabled, zero policies)
curl -s "$SUPABASE_URL/rest/v1/platform_settings?key=eq.chat_eval_last_run&select=value" \
  -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $SUPABASE_ANON_KEY"
# expect: []   (or a 401/permission error — NOT the row)

# an authenticated end-user JWT from tenant A: must also return zero rows
curl -s "$SUPABASE_URL/rest/v1/platform_settings?select=key" \
  -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $USER_JWT"
# expect: []

# service role: must return exactly one row
curl -s "$SUPABASE_URL/rest/v1/platform_settings?key=eq.chat_eval_last_run&select=value,updated_at" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
```

Any non-empty result from the first two is a **stop** — the migration's `REVOKE` or the
RLS enablement did not take.

Also run the repo's own gate:

```bash
pnpm check:migrations
```

### A6 — sentinel behaviour (the dead-man's-switch actually detects a dead man)

Local, against a beta/local Supabase, using the service role:

```bash
# (a) stale watermark -> FAIL + exit 1
#     set value.when to 72h ago, then:
SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/chat-eval-freshness.mjs; echo "exit=$?"
# expect: "FAIL · chat-eval-freshness · last run was 72.0h ago (limit 49h) — the nightly did not run", exit=1

# (b) fresh watermark, status ok -> OK + exit 0
# expect: "OK · chat-eval-freshness · last run 1.2h ago, status ok", exit=0

# (c) fresh watermark, status errored -> FAIL + exit 1
# expect: "FAIL · chat-eval-freshness · last run reported status=errored (TimeoutError…)"

# (d) row missing entirely -> FAIL + exit 1
# expect: "FAIL · chat-eval-freshness · no heartbeat row — the runner has never reported"

# (e) TRANSITION AWARENESS: run (a) twice in a row.
#     First run: alert emitted. Second run: FAIL line still printed, exit still 1,
#     but NO second email/webhook (state file unchanged, cooldown not elapsed).
```

Test (e) is not optional. A watchdog that alerts every tick gets muted by a human within
a week and the project is back to zero monitoring — the exact history documented in
`platform-health-cron.sh:13,18`.

### A7 — the live end-to-end proof — **[FOUNDER-EXECUTED]**

**Precondition: Step 0's 401 diagnosis is resolved and the eval credentials are known
good.** Until then this test cannot run, and that is fine — A1-A6 are the merge gate.
Running the nightly script performs a real sign-in, so **the executor never runs it, and
never runs it "just to see" whether the credentials work** (Step 0, Non-goal 3): one more
failed attempt escalates the lockout on the founder's own production login.

Once creds are good, on the founder's box, by the founder:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\nirpa\.shre\tasks\chat-eval-nightly.ps1
echo "exit=$LASTEXITCODE"
```

Then, in sequence:
1. `Get-Content C:\Users\nirpa\.shre\logs\chat-eval.log -Tail 20` shows
   `=== chat-eval nightly done (exit N) ===` and `heartbeat posted`.
2. Service-role read of `platform_settings` where `key = 'chat_eval_last_run'` shows a
   `when` within the last few minutes.
3. On aros-vps: `node scripts/chat-eval-freshness.mjs` prints `OK · chat-eval-freshness ·
   last run 0.0h ago, status ok` and exits 0.
4. **The failure path, deliberately:** temporarily point `CHAT_EVAL_BASE` at an
   unroutable host (e.g. `https://app.aros.invalid`) and re-run. The run errors, triage
   files/comments the `chat-eval/run/errored` issue, the digest fires, the heartbeat
   records `runStatus: 'errored'`, the runner exits non-zero, and the sentinel's next pass
   emits exactly one alert. **This is the 2026-07-23 scenario replayed end to end — it is
   the acceptance test for the whole track.** Do this instead of breaking credentials.

---

## Stop conditions — blocking questions for the founder, do not assume an answer

Referenced from §Credentials, §C6 and Step 7. **If a question here is unanswered when
you reach the step that needs it, do the additive half and stop — do not improvise.**

**Q1 — What is the OpenBao KV mount path for the chat-eval secret?** Step 7.6 needs
`<KV_PATH>`; nothing on this box demonstrates the convention. *Blocking for the vault
pull only; everything else in step 7 is independent.* **Recommendation:** the founder (or
whoever provisioned `vault.aros.live`) supplies the exact `bao kv get` line. **Never
discover it by probing, and never `bao kv put` a guessed path — a secret written to the
wrong path is a leak, and a `put` with partial keys can shadow a good secret.**

**Q2 — What is the `.dpapi` unwrap incantation** for
`vault--openbao-role-id.dpapi` / `vault--openbao-secret-id.dpapi` (262-byte raw
`ProtectedData` blobs, §Credentials)? The plausible form is
`[System.Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($p), $null, 'CurrentUser')`,
but no script on this box demonstrates it. **Recommendation:** confirm with the founder
rather than trial-and-error against AppRole login — repeated bad AppRole logins are
themselves an auth-failure signal on a live vault.

**Q3 — May the plaintext credential file ever be deleted, and by whom?** This brief's
answer is **no, not in this track** (Step 7.7). `C:/Users/nirpa/.shre/secrets/chat-eval.env`
is the last known-good copy, the founder currently cannot log in to re-mint it, and step
0's diagnosis is still open. **Recommendation:** keep it until three consecutive
vault-sourced green nightly runs, then let the founder retire it with a `.retired-` copy
kept offline. If the founder wants it gone sooner, that is their call to make explicitly —
not a step an executor performs.

**Q4 — What is the eval account going to be?** Step 0 may conclude the stored password is
stale (H1). Re-setting the founder's own `npatel@rapidrms.com` password is a founder
action with blast radius beyond this harness;
`scripts/chat-eval/README.md:84-85` recommends a dedicated `eval@` member per tenant
instead. **Recommendation:** create a dedicated eval account and store *that* in OpenBao,
so the watchdog can never lock out the founder. **No track here attempts a login, a
password reset, or an eval retry loop** (Non-goal 3).

**Q5 — `PLATFORM_ALERT_WEBHOOK` destination.** Step 6 POSTs the house payload when the
variable is set; it is **not** currently set for this process, and
`/usr/local/bin/platform-health-cron.sh` is a founder-owned file in no repo (Non-goal 4).
Email via `PLATFORM_ALERT_EMAILS` / `PLATFORM_ADMIN_EMAILS` is a real destination today,
so this is not blocking. **Recommendation:** ship email-only; the founder backfills the
webhook when they choose a destination.

**Q6 — Risk: alert storms.** §C6's transition-awareness (FAIL-set change + 20h re-notify
floor) is the property that keeps a multi-day outage to one page. If a reviewer wants
per-tick paging instead, stop and settle it before merge — the two designs are not a
config toggle apart. Rollback item 7 is the escape hatch either way.

---

## Non-goals

Do **not** touch these — other tracks own them, or they are out of scope:

1. **The battery.** `scripts/chat-eval/battery.json` and the scoring rules in
   `scripts/chat-eval/core.mjs` / `core.test.mjs` stay exactly as they are. Widening the
   12 synthetic questions to real traffic is **track F**.
2. **The `/v1/chat` 401 flakiness** seen at 2026-07-23T07:45Z, and the possible recurrence
   of the RLS-possessed-singleton class documented at `src/server.ts:2418-2423`. Flagged
   to the founder; a different layer, a different track.
3. **Actually changing any credential.** Diagnosis only (Step 0). No password resets, no
   login attempts, no eval retry loops — and **no deleting, moving, renaming, truncating
   or overwriting any credential file or vault key**, `chat-eval.env` above all (Step 7.6
   hard rule, Stop condition Q3). Adding a *new* read path is in scope; removing the
   surviving one is not.
4. **`/usr/local/bin/platform-health-cron.sh`.** Adding `app.aros.live` to its `DOMAINS`
   (line 22) and backfilling `PLATFORM_ALERT_WEBHOOK` are both good ideas and both
   founder decisions about a file that lives in no repo. Recommend; do not edit.
5. **Moving chat-eval to the VPS entirely.** `scripts/chat-eval/README.md:66-71` documents
   that deployment and it would collapse three problems at once, but it is blocked on the
   metering exemption (`README.md:80-82`). Out of scope; note it and move on.
6. **The golden-record layer.** `canonical_entity`, `entity_alias`,
   `canonical_strong_key`, `merge_candidate`, `negative_pair`, `merge_event`,
   `resolveCanonical()`, `src/golden/store.ts`. Nothing here goes near identity
   resolution. If you find yourself writing a second resolution path, stop.
7. **Any UI.** This track ships no user-facing surface, so the mobile-first / zero
   horizontal scroll at 320-1440px budget is not exercised. Say so in the PR body rather
   than claiming compliance you did not test.
8. **The journey gate.** No user-facing capability changes ⇒ no Journey Spec, no
   golden-path E2E. State this explicitly in the PR ("changes that don't alter a journey
   skip this — say so explicitly", `CLAUDE.md`).

---

## Collision warnings

### Package file-ownership register (RESOLVED 2026-07-24 — authoritative, identical in every brief)

This brief was written package-blind. The eight sibling briefs live beside it in
`docs/briefs/`. **One owning track per contested file. The arrows are a merge
order, not a preference.**

| File | OWNER (creates / restructures) | Merge order | Rule for non-owners |
|---|---|---|---|
| `scripts/chat-eval/triage.mjs` + `triage-core.mjs` | **THIS TRACK (E)** — structural: optional `results.jsonl`, try/catch per lane, `allIntents` replacing `issues` at `:55`/`:61` | **E → F** | You land first. **F** (`f-real-transcript-eval`) then adds `ENGINEERING_FAMILIES` entries and a `FAMILY_UMBRELLA` rewrite immediately after the `planIssueActions` call — it rebases onto your `allIntents`, not the reverse. |
| `scripts/chat-eval/core.mjs` | **F** steps 3–4 | **F → C(step 10)** | **Not this track — do not touch `core.mjs`.** `c-honest-data-contract` step 10 rewrites `hasErrorPhrase`/`scoreReply` after F; both edit the hard-fail list at `:105`. |
| `scripts/chat-eval/run.mjs` | **F** step 8 | — | Not this track. `a-conversation-persistence` adds only the new file `from-transcripts.mjs`. |
| `public.platform_settings` DDL | `supabase/migrations/20260723_platform_settings.sql:9-15` (already on main) | — | **No track re-declares this table — including this one.** Your heartbeat migration seeds the row and adds the missing `REVOKE`; it does **not** `CREATE TABLE`. See §Data contract C5. |
| `src/server.ts` `/v1/chat` dispatch block (`:6783-6792`) | **C** (`c-honest-data-contract`) | **C → D → I → A** | Not this track. Your step 5 adds a handler near `handleLogin` (`<:2390`) and a route after `:7104` — a different region entirely, no collision. |
| `src/server.ts` `proxyRequest` (`:948-1034`) | **B** (`b-auth-401-recovery`) steps 1–3 | **B(1–3) → A** | Not this track. |
| `apps/web/src/aros-ai/actions.ts` (NEW) | **D**, extended by **B** | **D → B** | Not this track (no UI surface — §7). |
| `apps/web/src/aros-ai/ArosChat.tsx` | **NOBODY — FROZEN** | — | Verified unmounted dead code. No track in the package edits it. |

**Globally satisfiable merge order for `src/server.ts`:**
**B(1–3) → C(step 3) → D → I → A(migration + steps 4–11) → F(6,7,9,10).**
Inside `scripts/chat-eval/`: **E → F(3,4,5) → C(step 10) → F(6,7,9,10)** —
**this track is the head of that chain**, so land steps 1–4 promptly; F is waiting.

---

| File | Risk | How to sequence |
|---|---|---|
| `src/server.ts` | ~7,000+ lines, actively edited by concurrent human/agent sessions and by other tracks in this same mission. | Add **only** the two blocks in step 5 — one handler before line 2390, one route after line 7104. Both are pure insertions at stable landmarks (`handleLogin`, the `/api/login` route). Do not reformat, do not reorder imports, do not touch `handleLogin` itself. Rebase on `origin/main` immediately before opening the PR. |
| `C:/Users/nirpa/Documents/Projects/aros` (primary checkout) | Currently on `feat/chat-first-redesign` with live concurrent sessions. `chat-eval-main` is a **worktree sharing its `.git`**. | Never run `checkout` / `switch` / `rebase` / `reset` / `merge` in either. `branch --set-upstream-to` and `pull --ff-only` inside the worktree touch refs and that worktree's tree only — verified safe (0 ahead / 2 behind `origin/main`). Read other refs with `git show origin/main:<path>`. |
| `C:/Users/nirpa/.shre/tasks/chat-eval-nightly.ps1` | Not in any repo; no version control; the scheduled task runs it at 04:47 local. | Back it up to `.bak-20260724` first. Do not edit it between 04:30 and 05:00 local. Consider proposing that it be moved into the repo (`scripts/chat-eval/nightly.ps1`) with a thin launcher — **propose, don't do it in this track**; the task action path would have to change and that is a founder action. |
| `supabase/migrations/` | Other tracks may add migrations the same day; filenames sort lexically and collisions are silent. | Use `20260724_chat_eval_heartbeat.sql`. Run `pnpm check:migrations`. **RESOLVED 2026-07-24 — the collision is a known quantity, not a guess: the package introduces exactly seven migrations and no two briefs declare the same filename.** Authoritative order, `README.md` § "Migration apply order": `20260724_canonical_strong_key_rls.sql` (G) → **`20260724_chat_eval_heartbeat.sql` (THIS TRACK)** → `20260724_chat_transcripts.sql` (A) → `20260724_entity_note.sql` (G) → `20260724_item_profile.sql` (G) → `20260725_chat_grades.sql` (F) → `20260725_customer_profile.sql` (H). This file has **no dependency on any of them** and none depends on it — it only needs `20260723_platform_settings.sql`, already on main. Do not append a discriminator; the slug is uncontested. |
| `scripts/chat-eval/triage-core.mjs` + `triage.mjs` | **RESOLVED 2026-07-24 — named, not "whichever track": `f-real-transcript-eval` also edits both** (its step 4 adds reason families to `ENGINEERING_FAMILIES` in `triage-core.mjs`; its step 5 rewrites `FAMILY_UMBRELLA` right after the `planIssueActions` call at `triage.mjs:61`). | **THIS TRACK OWNS BOTH FILES AND LANDS FIRST: E → F.** Your edits are structural — `triage.mjs:36` (optional `results.jsonl`), the try/catch around the two lanes, and `allIntents` replacing `issues` at both the `if (!issues.length)` guard (`:55`) and the `planIssueActions` call (`:61`). F post-processes the *return value* of that same call, so F must rebase onto your `allIntents` shape, not the other way round. In `triage-core.mjs` you still only **add** exports (`classifyRun`, `runErrorIntent`, `digestText`) and modify none of `buildTriage`, `ENGINEERING_FAMILIES`, `fingerprint`, `planIssueActions`, `renderIssueBody`, `renderRecurrenceComment` — keep it that way and F's additions merge mechanically on top. |
| `scripts/chat-eval/core.mjs` | **F** (steps 3/4) owns it; **C** (`c-honest-data-contract`, step 10) lands after F. | **This track does not touch `core.mjs` at all.** Keep it that way — three tracks in one 200-line file is already one too many. |
| `/opt/aros-platform` on aros-vps | Branch `live/direct-deploy` — a hand-managed fork, not `main`. Node v20.20.2. | You do not deploy. The sentinel lands in the repo; the founder pulls and schedules it. Do not use Node 21+ APIs. |

---

## Rollback

Ordered from cheapest to most invasive; each item is independently revertable.

1. **Runner (highest blast radius, fastest undo).**
   `Copy-Item C:\Users\nirpa\.shre\tasks\chat-eval-nightly.ps1.bak-20260724 C:\Users\nirpa\.shre\tasks\chat-eval-nightly.ps1 -Force`
   Restores the old fail-silent behaviour immediately. No scheduler change needed.
2. **Worktree upstream.**
   `git -C C:\Users\nirpa\.shre\worktrees\aros\chat-eval-main branch --unset-upstream` —
   but there is nothing to roll back *to*: `origin/chat-eval-budgets` is deleted on the
   remote (`git ls-remote --heads origin chat-eval-budgets` → 0 lines). Pointing at
   `origin/main` is strictly better than pointing at nothing. Do not undo this.
3. **Triage code.** Revert the PR. `triage.mjs` and `triage-core.mjs` are additive-only
   changes with no persisted state; reverting restores exact prior behaviour (including
   the ENOENT crash). Safe.
4. **Heartbeat endpoint.** Unset `CHAT_EVAL_HEARTBEAT_SECRET` on the server ⇒ the handler
   returns 401 for everything and writes nothing (the `!secret` guard is first). That is a
   config-only kill switch, no deploy needed for the *disable*; reverting the code needs a
   normal deploy.
5. **Watermark row.** `DELETE FROM public.platform_settings WHERE key = 'chat_eval_last_run';`
   Affects nothing else — the table's only other consumer is
   `automation_paused` (`src/server.ts:330`), keyed separately. The migration is
   `CREATE TABLE IF NOT EXISTS` + `INSERT … ON CONFLICT DO NOTHING`, so it is idempotent
   and re-runnable; there is no destructive DDL to reverse.
6. **Sentinel cron.** Founder removes the crontab line. The sentinel is read-only against
   Supabase and sends mail only on a state transition — the worst rollback case is
   deleting `/opt/shre-ops/state/chat-eval-freshness.json`, which re-arms one alert.
7. **Alert storm escape hatch.** If alerts become noisy before the transition logic is
   trusted: unset `PLATFORM_ALERT_EMAILS` / `PLATFORM_ALERT_WEBHOOK` in the sentinel's
   environment. It keeps printing `FAIL …` to `/var/log/chat-eval-freshness.log` and
   keeps exiting 1 — degraded to log-only, i.e. today's status quo, without a code change.
8. **OpenBao migration.** If the vault pull fails at 04:47 with the plaintext file already
   deleted, the run cannot authenticate — and with the founder currently unable to log in,
   there is nothing to restore from. **Therefore the rollback is that the file is never
   deleted by this track at all** (Step 7.6 hard rule, Stop condition Q3): the script
   prefers vault with an explicit, loudly-logged fallback
   (`Say 'WARN: vault pull failed - falling back to chat-eval.env'`), and retiring the
   plaintext is a separate founder-executed step (7.7) gated on three consecutive green
   vault-sourced runs, with a `.retired-20260724` copy kept offline. A *logged* dual path
   is acceptable for as long as it takes; a *silent* one is not. Rolling back the vault
   half is therefore free: delete the `bao` block, the fallback loader is already there.
