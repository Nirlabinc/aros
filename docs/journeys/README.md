# AROS golden journeys

The five paths that, if broken, mean AROS is broken for a real store owner —
regardless of what the test suite says. Each is a versioned Journey Spec
(template + rules: `.claude/JOURNEY_GATE.md`). They are walked **on the
deployed surface** before any user-facing release is called done.

## The persona: Ramesh

Every spec defaults to **Ramesh** unless it says otherwise:

- 58, owns one liquor store, 30 years behind the counter.
- Phone-first (checks AROS on his phone between customers), sometimes the
  back-office PC.
- ~15 minutes of patience for setup, ~15 seconds of patience per answer.
- Reads nothing longer than one line. Never opens documentation.
- Says "my store", "my register", "my numbers". Does not know the words
  *tenant, connector, API, schema, sync, credential*.
- If something fails silently or dead-ends, he doesn't file a bug — he stops
  using the product.

## The five journeys

| # | Spec | The user's goal |
|---|------|-----------------|
| 1 | [sign-up-and-see-value.md](sign-up-and-see-value.md) | "Show me what this thing does" — signup to a real-feeling answer on sample data, fast. |
| 2 | [connect-my-store.md](connect-my-store.md) | "Put MY numbers in here" — from sample data to his live store. |
| 3 | [ask-a-question-get-a-real-answer.md](ask-a-question-get-a-real-answer.md) | "What were my sales yesterday?" — a real, honest, sourced answer in chat. |
| 4 | [check-on-my-store-today.md](check-on-my-store-today.md) | "How's my store doing?" — the daily look: briefing, numbers, anything needing attention. |
| 5 | [get-unstuck.md](get-unstuck.md) | "Something's wrong" — every failure on journeys 1–4 recovers self-service. |
| 6 | [accept-terms-and-ai-disclosure.md](accept-terms-and-ai-disclosure.md) | "Fine, I agree" — clickwrap terms gate + first-chat AI disclosure. **Flagged off** (`TERMS_GATE_ENABLED`) until attorney sign-off. |
| 7 | [install-an-app-from-marketplace.md](install-an-app-from-marketplace.md) | "I want that" — find an app (Documents, EDI Invoices) in the Marketplace, activate it, open it. |
| 8 | [manage-my-account.md](manage-my-account.md) | "That's not my name" — update display name / password from the Profile page. |

## How they're enforced

1. **Before code** — a new/changed user-facing capability updates its spec
   first (`journey-council` subagent drafts it). Every user-facing PR names
   the spec + step it serves, or states `no user-facing change`.
2. **Pre-merge** — `app-ux-journey` + `app-slice-coherence` review the code;
   the golden-path E2E (when one exists for the journey) must be green.
3. **Pre-release** — walk the deployed surface:
   `node scripts/journey-walk.mjs --base <url>` (seam-level HTTP walk:
   routes, wired backends, fail-closed APIs), then the `journey-walker`
   subagent browser-walks the steps marked `NEEDS-BROWSER`.
4. **Persona replay (EARNED 2026-07-17)** — `node scripts/journey-replay.mjs
   --base <url>` walks the golden path as Ramesh in a headless browser
   (phone viewport, dedicated test-workspace account via
   `REPLAY_EMAIL`/`REPLAY_PASSWORD`; `REPLAY_MUTATIONS=1` adds the
   bogus-credentials failure walk — test workspaces only). Non-zero exit
   blocks the invoker: it runs daily from the aros-vps cron next to the seam
   walk, and belongs in any deploy/promote checklist.

**Definition of done: Ramesh completes the journey on beta without help.**

Known gaps between these contracts and the current build (with file refs):
[WALK-FINDINGS.md](WALK-FINDINGS.md) — the punch list; it trends to empty.
