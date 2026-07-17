# Journey gate (the user journey is an artifact, not an intention)

AROS ships to non-technical store owners. Features keep shipping *technically*
complete but journey-broken: a complete connectors backend with **no UI path
that reached it** (2026-07-14 audit), sidebar links that silently rendered the
dashboard, mock sales data with no cue it was fake, and a chat surface that
fabricated numbers because the data activation behind it was never wired. In
every case the code passed the gate — the journey didn't.

This is the AROS copy of `shre-dev-kit/discipline/JOURNEY_GATE.md`.

## The rule

**No new user-facing capability starts as code. It starts as a Journey Spec**
at `docs/journeys/<slug>.md`, written before design or implementation and
updated whenever the flow changes. Changes that don't alter how a user enters,
moves through, or completes a journey (copy tweaks, refactors, backend-only
work behind an unchanged surface) skip this — say so explicitly, so it's a
decision, not an omission.

The golden journeys live in `docs/journeys/` (index: `docs/journeys/README.md`).
Every user-facing PR names the journey spec + step it serves, or states
`no user-facing change`, or ships the new/updated spec in the same PR.

## The artifact — Journey Spec template

Copy into `docs/journeys/<slug>.md`:

```markdown
# Journey: <verb phrase — e.g. "Store owner connects their POS">
Persona: <who + tech literacy — default: Ramesh, see docs/journeys/README.md>
Trigger: <the real-world moment that makes them start>
Entry point: <the exact URL / screen / message they land on>

## Golden path (budget: ≤ 5 steps / ≤ 5 minutes)
| # | User sees | Must already know | The ONE action they take |
|---|-----------|-------------------|--------------------------|
| 1 |           | *(target: nothing)* |                        |

## Failure states (every way each step can fail)
| Step | What goes wrong | What the screen says | Self-service recovery |
|------|-----------------|----------------------|-----------------------|

## Empty states
<what a brand-new account sees before any data exists — helpful, not a blank void>

## Success signal
<how the USER knows it worked — visible on screen, not a backend log line>

## Activation dependencies
<flags, credentials, operator steps, or data syncs the journey needs to
deliver REAL value — and what the UI honestly shows until they're wired>

## Out of scope
<adjacent journeys this spec deliberately does not cover>
```

## The two dummy-proof invariants

1. **"Must already know" trends to zero.** Any non-empty cell is either
   eliminated by design or moved into the UI as an inline hint at that step.
   Knowledge that lives in docs, onboarding calls, or the founder's head does
   not count. Vocabulary check: Ramesh says "my store", never "tenant",
   "connector", "API", or "schema".
2. **Every failure row recovers without support.** If the only recovery is
   "contact us" or an operator fixing it from the backend, the journey is not
   done — it's staffed.

## The merge gate

A PR that adds or alters a user-facing journey merges only when:

- [ ] The Journey Spec exists at `docs/journeys/<slug>.md`, created or
      updated by this change.
- [ ] A **golden-path E2E** drives the real UI end-to-end *as the persona
      would*: starts at the entry point, reads only what's on screen, no
      seeded magic state, no API shortcuts. It asserts the **success signal**,
      not a 200.
- [ ] Every failure row has an implemented, self-service recovery (the
      `app-ux-journey` reviewer's rails verify the code side).
- [ ] **Activation is part of the journey.** If the capability needs a flag,
      credential, or operator step to deliver real data, the spec's
      activation section covers it and the UI states it honestly until wired.
      A surface that renders plausible output while unwired is a **defect**,
      not a placeholder.
- [ ] Gate command for the touched journey:
      `node scripts/journey-walk.mjs --base <deployed-url>` (seam-level HTTP
      walk, today) + the touched journey's E2E under `scripts/e2e.sh` once a
      suite exists for it. Steps the HTTP walk marks `NEEDS-BROWSER` are
      walked via the `journey-walker` subagent (or shre-browser recipe) before
      release.

**Definition of done: the persona completes the journey on beta without
help.** Not the endpoint returning 200, not the PR merging, not the demo
working with the author driving.

## Journey replay (automation — earn it last)

Once a journey's spec + walk have been stable through a few releases, add an
automated persona replay to the beta stage of the deploy pipeline: a browser
agent (shre-browser `:5476` recipe engine) pointed at beta with a prompt of
the shape —

> "You are Ramesh. You've never seen this app. Your goal: [journey trigger →
> success]. You may only click what you see and read what's on screen — no
> docs, no dev tools. Narrate every moment of confusion and stop when stuck."

The transcript is a usability test; a stuck persona on the golden path blocks
promotion to prod. Per the cadence rule, do not build this before the manual
flow is proven — automation adds cost, risk, and maintenance.

## Fit with the rest of the kit

`journey-council` (agent) drafts the spec before design → this gate holds the
build to it at merge → `app-slice-coherence` + `app-ux-journey` review the
implemented slice → `journey-walker` walks the deployed surface (beta) →
ship on green → replay guards the beta→prod promotion.
