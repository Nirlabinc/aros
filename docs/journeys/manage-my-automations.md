# Journey: Store owner reviews and manages their alerts
Persona: Ramesh (see README.md)
Trigger: He set up a "text me when someone voids a transaction" alert by
chatting, and now wants to check it's on — or a stream of alerts is too noisy
and he wants to pause one. He goes looking for "where my alerts live".
Entry point: `https://app.aros.live/notifications` (Notifications page), reached
from the account/settings menu.

## Golden path (budget: ≤ 3 actions / ≤ 1 minute)
| # | User sees | Must already know | The ONE action they take |
|---|-----------|-------------------|--------------------------|
| 1 | An **Automation rules** panel listing each alert in plain words ("text when a transaction is voided — active"), when it was last checked and last fired | *nothing* | Reads it |
| 2 | Each active rule has **Disable** + **Delete**; a disabled rule has **Enable** | *nothing* | Taps **Disable** on the noisy alert |
| 3 | The row updates to show the new status; nothing else changes | *nothing* | (Goal reached — the alert is paused) |

## Failure states
| Step | What goes wrong | What the screen says | Self-service recovery |
|------|-----------------|----------------------|-----------------------|
| 1 | No rules yet | "No automation rules yet. In chat, try: 'text me when someone voids a transaction'." | Points him to the chat entry that creates one |
| 1 | Rules fail to load (API/network) | "Rules unavailable" card with the reason + a **Try again** button | Retry, no blank space |
| 1 | A rule is waiting on a store connection | Status reads "waiting on store connection" (not "active", never a silent lie) | It activates itself once the store connects; nothing to do |
| 1 | A rule auto-paused after too many alerts | Status reads "paused — too many alerts" | **Enable** re-arms it once things look normal |
| 2 | He is a member/viewer, not owner/admin | Buttons are replaced by "owner/admin manages" | He asks an owner/admin (create/change is gated) |
| 2 | The change can't be saved | Inline note with the reason | Retry; the list re-loads from the server so it never lies about state |

## Empty states
A brand-new workspace with no rules sees the "No automation rules yet" line with
the exact chat sentence that creates the first one — not a blank panel.

## Success signal
Ramesh sees his alert in the list with an honest status, and can pause, re-enable,
or delete it in one tap — the row reflects the real server state immediately
after. He never wonders "is this actually on?".

## Activation dependencies
- `GET /api/automations` (list, member-visible) and
  `PATCH`/`DELETE /api/automations/:id` (owner/admin, audited) — live in this
  slice.
- The **status** shown is the real row status the sentinel maintains
  (active / pending connector / suspended / disabled); "last checked" / "last
  fired" come from the sentinel's `last_checked`/`last_fired` writes. Until the
  sentinel has run a pass, "last checked" honestly reads "never".
- Creation stays in chat (the confirm-card flow) — this page manages existing
  rules; it does not add a create form.

## Out of scope
Creating a rule from this page (chat-only in v1); scheduled reports (Phase 2);
per-rule fire history / audit drill-down; notification-preference toggles (the
existing per-channel section on the same page covers those).

## Golden-path E2E note (merge gate)
No browser E2E suite is wired for the `/notifications` surface in this repo yet
(`scripts/e2e.sh` has no notifications spec; `pnpm --filter @aros/web e2e` is
Playwright-ready but this journey has no spec file). Deferred with cause: the
panel is additive on an existing page, all states are server-truth (no seeded
magic state), and the seam-level walk
(`node scripts/journey-walk.mjs --base <url>`) plus the `journey-walker`
subagent cover it at release. Follow-up: add a Playwright golden-path spec that
signs in as an owner, opens `/notifications`, and asserts a created rule's row +
status render, once the deploy lands.
