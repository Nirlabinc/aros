# Journey: Store owner connects their POS and sees THEIR numbers
Persona: Ramesh (see README.md)
Trigger: The sample-store demo convinced him; he wants his own store in AROS.
Entry point: The **"Connect your store"** CTA on `/start`, the sample-data
banner on the dashboard, or **Stores** in the sidebar — all landing on
`/connect`.

## Golden path (budget: ≤ 5 steps / ≤ 15 minutes)
| # | User sees | Must already know | The ONE action they take |
|---|-----------|-------------------|--------------------------|
| 1 | `/connect` — his POS brands by name and logo (RapidRMS, Verifone, …), not "connector types" | which register/back-office he uses (he knows its name) | Tap his POS |
| 2 | A short form asking only for what that POS needs, each field explained in one line ("the email you use to log into RapidRMS back office") | his POS login | Fill it in |
| 3 | One button: **Save & Test Connection** | *nothing* | Tap it |
| 4 | In-flight state ("Checking with RapidRMS…"), then **"Connected — we found your store"** with a recognizable detail (store name / today's transaction count) | *nothing* | Tap **Go to my dashboard** |
| 5 | Dashboard with **his** numbers; the sample-data banner is **gone** | *nothing* | (Goal reached) |

## Failure states
| Step | What goes wrong | What the screen says | Self-service recovery |
|------|-----------------|----------------------|-----------------------|
| 3 | Wrong credentials | "RapidRMS didn't accept that login — check the email and password you use at backoffice.rapidrms.com" | Fix and re-test; **typed input preserved** |
| 3 | POS unreachable / timeout | "We couldn't reach RapidRMS right now — this is on their end, try again in a few minutes" | Retry button; saved draft kept |
| 3 | Save succeeds but test fails server-side | The truth: saved but not working, with the failing reason | Edit & re-test from the same screen |
| 4 | Connected but no data has synced yet | "Connected — your sales are loading, first numbers within X minutes" | Dashboard states "syncing" honestly instead of showing zeros or samples unlabeled |
| any | He doesn't know which POS he has | A "Not sure?" hint describing each option in plain words | Picks by description; contact path as last resort, not first |

## Empty states
Before any connection exists, `/connect` is the sales pitch for connecting:
what he'll get (his real sales, alerts, answers) — not an empty table of
"no connectors configured".

## Success signal
The dashboard shows numbers Ramesh recognizes as his own (today's sales he
can sanity-check against the register) and nothing on the screen says
"sample" anymore.

## Activation dependencies
- `/api/connectors` + `/api/connectors/test` live, with the
  `tenant_connectors` migration applied on the environment's database.
- Credential encryption + vault provisioning for the tenant (creds must flow
  to the sync jobs — the activation contract).
- Per-tenant data sync actually scheduled after connect (historically
  hardcoded to one store — a silent gap this spec makes a FAIL).
- Until sync delivers rows, dashboard says "syncing", never fake zeros and
  never unlabeled sample data.

## Out of scope
Multi-store chains, marketplace app installs, EDI/back-office document flows.
