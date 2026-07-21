# Journey: Store owner installs an app (Documents / EDI Invoices) from the Marketplace
Persona: Ramesh (see README.md)
Trigger: He heard AROS can hold his supplier invoices and store paperwork; or he
tapped **Documents** somewhere and it said it isn't installed yet.
Entry point: **Marketplace** in the sidebar (`/marketplace`), or the
**Install from Marketplace** button on an uninstalled app's page
(`/documents`, `/edi-invoices`).

## Golden path (budget: ≤ 4 steps / ≤ 2 minutes)
| # | User sees | Must already know | The ONE action they take |
|---|-----------|-------------------|--------------------------|
| 1 | `/marketplace` — app cards with plain-word descriptions ("Workspace document storage — upload, organize…"), each showing Active/Inactive | *nothing* | Tap the app card (e.g. **Documents**) |
| 2 | An app profile dialog: what it does, exactly what access it requests, what activating unlocks | *nothing* | Tap **Activate app** |
| 3 | The card flips to **Active** with an **Open** button; the app also appears in his profile-panel Workspace nav | *nothing* | Tap **Open** |
| 4 | The app's own page (`/documents` or `/edi-invoices`) with its real empty/first-run state | *nothing* | (Goal reached) |

## Failure states
| Step | What goes wrong | What the screen says | Self-service recovery |
|------|-----------------|----------------------|-----------------------|
| 1 | Catalog fails to load | "Marketplace unavailable" note with the error and a **Retry** button | Retry in place |
| 2 | He's a Member, not owner/admin | Server refuses (403 "Owner or admin role required"); UI surfaces the message | Ask their owner; the message names the role needed |
| 2 | Install API fails | Error note on the page, card stays Inactive | Retry activation |
| any | He deep-links `/documents` without the app installed | "Documents isn't installed in this workspace" + **Install from Marketplace** button — never a broken or blank page | One tap to the Marketplace |
| 4 | Documents backend (MIB bridge) not yet provisioned for the tenant | The Documents page's own error/empty state; server provisions the tenant token on first use automatically | Reload after a moment; re-activating from Marketplace re-runs provisioning |

## Empty states
- Marketplace always has the built-in catalog (Documents, EDI Invoices, StorePulse, …) — it is never blank.
- A freshly installed Documents shows its own first-run empty state (no files yet), not a void.
- `/connectors` and `/plugins` with nothing active say so and offer **Browse Marketplace**.
- `/apps` (Active apps) lists only installed apps, A→Z with search on top; with
  nothing installed it says so and offers **Browse Marketplace**.

## Success signal
The app card reads **Active**, the app shows up in his Workspace nav, and
opening it lands on the app's real page — no "not installed" screen.

## Activation dependencies
- Migration `20260720_embedded_marketplace_apps.sql` applied (adds
  `platform_apps.embedded` + `description`, seeds `documents`/`edi-invoices`,
  grandfathers existing tenants so nobody loses access they had).
- `/api/apps`, `/api/marketplace/entitlements`, `/api/marketplace/install`,
  `/api/apps/:id/grant` live (all pre-existing).
- Documents needs `MIB_DOCS_BASE_URL` + `MIB_DOCS_ADMIN_TOKEN` server-side for
  the per-tenant token registration; until wired, the Documents page shows its
  own honest error state (never fabricated content).

## Out of scope
- Using the Documents / EDI Invoices apps themselves (their own journeys).
- Third-party/external apps that launch on their own subdomain (StorePulse etc.).
- Billing/paid apps — every current catalog app installs free.
