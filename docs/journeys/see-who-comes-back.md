# Journey: Store owner finds out who comes back

**Status:** DRAFT — founder approval required before any schema (mission
`docs/missions/retail-profiles.md`).
**Persona:** Ramesh (`docs/journeys/README.md`) — one liquor store, phone-first,
~15 seconds of patience per answer.
**Trigger:** a rep offers a promo deal, or a slow Tuesday. His real question:
*"Am I getting people BACK, or is it all one-time walk-ins?"*
**Entry:** `/marketplace` (Apps tab) → **Customers** card. After activation:
**Customers** in the workspace nav (`/customers`), plus deep links from chat.

> Ship as an **app**, not a "plugin". `/marketplace?tab=plugins` renders two
> hard-coded cards behind a DISABLED button ("Tenant-scoped authorization bridge
> required"). The wired activation path is the Apps tab.

## Golden path (≤5 steps, ≤3 minutes)
| # | He sees | Must already know | His one action |
|---|---|---|---|
| 1 | Card: **Customers** — "See which shoppers come back and how often. We use only the card type and last 4 digits — never the full card number." Badge: Inactive | nothing | Tap card |
| 2 | Dialog runs a **LIVE CHECK against his own register** before offering activation: ✅ "Your register tells us the card type and last 4 — good" or ✕ "Your register doesn't send card details, so we can't tell one shopper from another. **There's nothing to turn on yet.**" Activate is disabled unless the check passes | nothing | Tap **Turn on Customers** |
| 3 | Card flips **Active**; **Customers** appears in nav | nothing | Tap **Open** |
| 4 | One sentence: **"Last 30 days: 1,240 card payments from about 900 different cards. 210 cards came back more than once — that's 23%."** Under it, permanently: *"We don't know anyone's name. We recognize the card they pay with. Cash customers aren't in here."* Then **Cards that came back most**: `VISA ••••4412 · 9 visits · $214 spent · last seen Tuesday` | nothing | Tap a row |
| 5 | Visits, total spent, average basket, first/last seen, **what they usually buy** (top 5), usual time of day, **note box** | nothing | Read, or add a note |

## The activation gate (the load-bearing design decision)
Activation is **blocked at step 2** by a live per-tenant probe. The app is never
"activated but empty". If the register sends no card detail, he is told so in his
own words, once, before investing any effort — and offered **Tell me when this
works** rather than a broken app.

## Failure states
| Step | Goes wrong | Screen says | Recovery |
|---|---|---|---|
| 2 | Not owner/admin | 403 naming the role and who can act | Owner acts |
| 2 | No store connected | "First connect your register — that's where the payments come from." | **Connect my store** |
| 2 | Register unreachable during check | "We couldn't reach your register just now." | **Check again** — never activates on an unknown |
| 2 | Register sends no card detail | "Nothing to turn on yet." | Honest dead end |
| 4 | No card payments yet | "No card payments yet in the last 30 days." + the real count seen (0) | Auto-fills on next sync |
| 4 | <14 days history | "We've only got 6 days so far. 'Came back' numbers get real after a couple of weeks." | Time |
| 4 | Connector disconnected since activation | Amber: "We lost the connection on Tuesday. These numbers stop there." | **Fix my connection** |
| 4 | **No stable card token — brand+last4 only** | Header relabels to **returning cards**, and adds: *"Two different people with cards ending in the same 4 digits look the same to us, so this is a close estimate, not a headcount."* | The honesty IS the fix |
| 5 | Card seen once | "Seen once, on 12 July. Nothing more to say yet." — not an empty chart | — |
| 5 | Two cards may be one person (re-issue) | **Never auto-merged.** "Might be the same person" + **Yes, same** / **No, different** | "No" remembered forever (`negative_pair`), never re-asked |
| 5 | Note save fails | Text preserved + "Couldn't save — tap to try again" | Retry; input never cleared |
| any | Stale data | "as of 9:40 AM" + **Check now** | One tap |

## Empty states
Never a zeroed dashboard. If card detail is unavailable for this tenant: a single
honest screen, no tiles, no charts — *"We'll turn this on by itself the day it
does."* **No sample or plausible numbers, ever.**

## Success signal
The top line states a real sourced count he can act on — *"210 of 900 cards came
back more than once (23%)"* — with an "as of" time, and a row opens a real card
with a real visit count from his own invoices.

## Activation dependencies
| Dependency | State | Honest UI until wired |
|---|---|---|
| Connected store connector | Exists | "First connect your register" |
| Card brand + last-4 on invoice | **PARTIAL — verified present on ~2% of invoices** (Cortex probe 2026-07-23: 456 of 20,405 payment rows; brands VISA/MASTERCARD/DISCOVER/DEBIT) | Live probe blocks activation |
| **Stable per-card token** | **ABSENT** — no contract anywhere | Labels switch to "cards"; caveat permanent |
| **Golden-record ingest** — something must call `resolveCanonical(createGoldenStore(), …)` per transaction | **NOT WIRED** — only callers are two unit tests | Without it there is no "customer" in this system. **#1 build item** |
| `card_fp` added to `STRONG_KEYS.customer` (`src/golden/resolve.ts`, today `phone_hash`/`email_hash`) | Not present | — |
| Merge review surface (`merge_candidate`; `negative_pair` suppression explicitly unwired in `resolve.ts`) | Not built | "Might be the same person" hidden; **no auto-merge under any circumstance** |
| `entity_note` table + RLS (shared with Item Profile) | Not built | Note box hidden, not shown-and-broken |
| `platform_apps` row + capability bundle + **409 gate** on `/api/customers/*` (copy `/api/documents/*`) | Not built | "not installed" + install button |
| **Legal/privacy review** of storing a card fingerprint + purchase history | Not done | **Gate: do not deploy to a real tenant before sign-off** (mirrors `TERMS_GATE_ENABLED`) |

## Out of scope
Names, emails, phones, loyalty enrolment, marketing sends — those are Customer
Fabric / REGULARS (`regulars.aros.live`), not this. Also: the consumer surface,
cross-store identity (founder decision pending — until then count per store and
say so), any POS write, and cash customers (stated on screen, not silently
omitted).
