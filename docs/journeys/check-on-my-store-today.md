# Journey: Store owner checks on their store today
Persona: Ramesh (see README.md)
Trigger: Morning coffee, or a quiet moment — "how's my store doing?" The
habitual open-the-app moment this product lives or dies on.
Entry point: Opening `https://app.aros.live` while signed in (lands on the
default signed-in surface), or tapping **Dashboard**.

## Golden path (budget: 0 actions / ≤ 10 seconds to the picture)
| # | User sees | Must already know | The ONE action they take |
|---|-----------|-------------------|--------------------------|
| 1 | Today at a glance, **his real data**: sales so far, vs. usual, anything needing attention (low stock, unusual activity) | *nothing* | None — the picture is just there |
| 2 | If something needs attention: a plain-words alert ("12 items are running low") | *nothing* | Taps the alert |
| 3 | The detail behind the alert (the list of items), with the obvious next step | *nothing* | (Goal reached — informed, maybe acts) |

## Failure states
| Step | What goes wrong | What the screen says | Self-service recovery |
|------|-----------------|----------------------|-----------------------|
| 1 | Data sync is stale/behind | "Numbers as of 9:40 AM" — data is timestamped, staleness visible | He knows what he's looking at; persistent staleness surfaces as its own alert |
| 1 | Store not connected | The labeled sample dashboard + connect banner (journeys 1–2) | Banner → `/connect` |
| 1 | Backend/API failure | A friendly failure card, cached last-known numbers if available, clearly timestamped | Retry; never a blank white screen or spinner forever |
| 2 | Alert is wrong/noisy (e.g. "0 remaining" on miscounted inventory) | Alert links to the underlying data so he can see why | A visible way to dismiss/mute that alert |

## Empty states
First morning after connecting, before a full day of data: "We're collecting
your first full day — here's what we have so far", partial numbers labeled as
partial. Not zeros presented as truth.

## Success signal
Within ten seconds of opening the app, Ramesh knows (a) roughly how today is
going and (b) whether anything needs him — without tapping anything. The
numbers match reality when he checks the register.

## Activation dependencies
- Dashboard + briefing endpoints (`/api/dashboard`, `/api/human/briefing`,
  `/api/store/summary`) reading the tenant's **real** synced data.
- The mock-data fallback must be labeled sample-only and gated to
  unconnected tenants (this shipped unlabeled: fake $4,827 sales presented
  as real).
- Alert thresholds seeded with sane defaults per store size — an alert
  storm on day one kills the habit this journey builds.

## Out of scope
Deep reporting/exports, multi-store rollups, acting on alerts beyond viewing
detail (reorder flows are their own journey).
