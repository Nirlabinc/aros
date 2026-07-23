# Retail profiles — Customer Profile & Item Profile plugins

Founder ask (2026-07-23): activatable **Customer Profile** and **Item Profile**
plugins. Customers grouped from invoices by card identity to separate repeat
from new. Items profiled by what sold, on which invoices, with complementary
products, repeat buyers, last order, and **min/max stock guidance** — where
"health" is driven by **sales frequency and is user-adjustable**, the
**stock-hold horizon is adjustable (2 weeks / 6 months / 1 year)**, and each
item resolves to the **purchase deal/group it came in under, with comments**.

## Intent
- Outcome: two owner-facing plugins that turn existing invoice/item data into
  two decisions an owner actually makes — *"is this customer worth keeping?"*
  and *"should I reorder this, and how much?"* — with every number traceable to
  a real row.
- Why now: the data (invoices, line items, item master) is already flowing into
  Cortex/RapidRMS, and the canonical-entity foundation for customer/product
  identity is already merged but unused for this.
- Non-goals: loyalty programs, promotions/campaign execution, consumer-facing
  surfaces, checkout, or anything that duplicates REGULARS (see §Patent
  adjacency). No marketing email. No price optimisation in v1.

## FOUNDER DECISIONS — RESOLVED 2026-07-23 (all three probed against live Cortex)

**D1 — Customer key = card type + last 4–5 + cardholder name.** No processor
token is required. Founder's proposal validated against real data: in the live
sample, brand+last4 alone yields **232** distinct identities; adding cardholder
name yields **237** — i.e. the name resolved **5 genuine collisions** (~2%).
Cardholder name is present on **242 of 476** payment rows (51%), expiry on 247.
Design: composite key = `cardType | last4 | normalized(cardHolderName)`, with
expiry as an additional discriminator where present. **When the name is absent,
fall back to brand+last4 but mark the match LOW CONFIDENCE and route it to the
`merge_candidate` review queue — never auto-merge.** Cardholder name is
permitted under PCI (the PAN is what must be unreadable) but is PII: access-
controlled, never logged, never shown beyond the owner's own workspace.

**D2 — One resolver. AROS and REGULARS are both Nirlab products.** Founder
confirms shared ownership, so the canonical customer/product resolver lives
ONCE in the shared golden layer (`canonical_entity` + `createGoldenStore()`),
and both products are views over it. This settles the earlier open question in
favour of a single graph — no fork, no parallel identity system.

**D3 — "Deal" = a TIERED BULK VENDOR PROMO** that improves buy-side margin
(e.g. buy 1 case → $1 off; buy 3 cases → $10 off). This is distinct from
`deal-hunter.ts`'s single-SKU promo price — **rename that skill's concept or
the UI term; two meanings of "deal" is a support burden.**
**Data verdict (probed): deal TERMS are NOT available.** `rapidrms.
promotion_snapshot` exists but has **0 rows** (empty sync scaffold);
`purchase_order` and `cost_ledger_po_progress` are **0 rows**; the promotion
endpoints (`/api/Discount/SalesByPromotion`, `/Promotion`) return 400/404.
**But the deal OUTCOME is available**, which is what actually drives margin:
`rapidrms.cost_ledger` has **76,338 rows** with `item_code`, `upc`,
`event_type`, `qty`, `uom`, **`units_per_case`**, `unit_cost`, `qty_after`,
`avg_cost_after`, `source`, `source_ref`, `event_at`; plus
`rapidrms.item_vendor` (**81,942 rows**) and `rapidrms.vendor` (39).
So v1 shows the realised cost effect — *"when you took 3 cases on 12 July your
unit cost was $18.40 against your usual $19.60"* — sourced from real rows,
rather than claiming terms we cannot see. Capturing the terms themselves is
either owner-entered (from the rep's sheet, with the comment field) or a
future endpoint/BOS discovery, and is explicitly a separate increment.

## HARD CONSTRAINTS (design WITH these, not around them)

### C1 — PCI: never store a card number
Repeat-customer identity keys on **card brand + last-4 + a salted hash of the
processor token**, never the PAN. The PAN must not be stored, logged, displayed,
or returned by any API. Analytically nothing is lost: "this same card returned
14 times" works identically on a hashed key. Any design that persists a PAN is
rejected outright. Salt is per-tenant and vault-held; hashes are not portable
across tenants.

### C2 — EXTEND the golden-record layer, never fork it
Already merged in this repo: `canonical_entity`, `entity_alias`,
`canonical_strong_key`, `merge_candidate`, `negative_pair`, `merge_event`,
`resolveCanonical()` and `src/golden/store.ts` `createGoldenStore()` (PRs
#108/#143). It already assigns canonical IDs to **customer and product**
entities with deterministic matching, an alias registry (a resolved duplicate
never re-creates), and a fuzzy **review queue that never auto-merges**.
A prior pre-audit caught and stopped a second parallel canonical-entity system.
**Both plugins bind to `createGoldenStore()`; new profile tables carry a
`canonical_id` FK and add no competing identity resolution.**

### C3 — Patent adjacency (declare, don't silently fork)
Customer Fabric / **REGULARS** is patent-pending (US Provisional 64/113,480)
and owns consumer identity, consent tiers, loyalty and the customer-facing
surface at `regulars.aros.live`. **Customer Profile here is the OWNER-SIDE
analytic view of their own transaction data** — pseudonymous, in-store, no
consumer account, no consent tier, no cross-merchant portability. Any feature
drifting toward consumer identity, loyalty, or cross-store recognition belongs
to REGULARS and must be escalated, not built here.

### C4 — No number without a verified data contract
Prior recon proved the RapidRMS API carries `isVoid` and that
refund/no-sale/cashier attribution is **not** available, and that tender/shift
endpoints do not exist (timecards needed a BOS website adapter). Therefore
**card brand/last-4, register/terminal name, deal/group membership, and
transaction exception types are UNVERIFIED until Phase 0 says otherwise.**
Every screen states honestly what it cannot yet know. Plausible output from an
unwired surface is a defect, not a placeholder.

### C5 — App build standards
shre-id identity; multi-tenant with RLS from the first migration;
server-enforced RBAC; Supabase; realtime where it earns it; named performance
budgets; Stripe/Apple-grade UI; mobile-first with **zero horizontal scroll at
320–1440px**. (`shre-dev-kit discipline/APP_BUILD_STANDARDS.md` — dev-kit PR #41
still open; requirements mirrored in the root `CLAUDE.md`.)

### C6 — Activation reuses the existing plugin model
`tenant_connectors` → provisioning manifest → `tenant_resources`, the same path
existing AROS apps use. No bespoke activation.

## Scope

### Phase 0 — Data-contract freeze (GATE, running)
Recon answers, per field, AVAILABLE / PARTIAL / NOT AVAILABLE with evidence:
register/terminal identity · exception types (cancel, price change, manual
discount) · payment fields (brand, last-4, entry method, token — and whether any
PAN is exposed) · item deal/group linkage · what the golden layer already
supports · existing overlapping surfaces.
**Nothing is designed against a field until this freezes it.** Fields that come
back NOT AVAILABLE become either a BOS-capture sub-task (the proven timecard
pattern) or an explicitly deferred feature — never a silent assumption.

### Phase 1 — Journey Specs (GATE, running)
`journey-council` drafts a spec per plugin: persona, golden path with zero
assumed knowledge, activation dependencies, failure/empty states with
self-service recovery, the plain-language adjustable controls, and the
user-visible success signal. **Founder approves both specs before any schema.**

### Phase 2 — Item Profile (first; its data is most likely to exist)
Per-item canonical profile bound to `canonical_entity`: units sold and on which
invoices, sales history over a chosen window, last sold, repeat buyers (count
only, pseudonymous), frequently bought together, and **min/max carry guidance**.
- **Health = sales frequency, owner-adjustable.** Ships with sane defaults and
  plain-language thresholds — the UI must not require the owner to understand
  statistics. Defaults are a starting point, not a hidden model.
- **Stock-hold horizon adjustable: 2 weeks / 6 months / 1 year**, driving the
  min/max recommendation. An item selling daily and one selling twice a year
  must both produce sensible guidance under the same control.
- **Deal/group linkage + free-text comments** per item (gated on Phase 0).

### Phase 3 — Customer Profile (gated on C1 design + Phase 0 payment verdict)
Pseudonymous customer profiles from invoice payment identity: repeat vs new
counts, visit frequency, last visit, basket size, items bought. Keyed on the C1
hashed card identity, resolved through `createGoldenStore()`.
If Phase 0 finds no usable payment identifier, this phase **stops** and the
founder chooses an alternative key (loyalty ID, phone, manual tagging) rather
than the work proceeding on an assumption.

### Phase 4 — Register name + exception types on alerts
Add register/terminal to the automation alerts and, where Phase 0 confirms a
contract, new triggers: **cancelled transaction, price change, manual discount**
(alongside the shipped void alert). Each new trigger is independently gated on
its verified field. Rides the existing automation engine
(`docs/missions/aros-automation-rules.md`) — no new engine.

- Repos/services: `Nirlabinc/aros` (plugins, UI, API), Cortex warehouse reads,
  Supabase (aros app DB).
- Surfaces/users: owner-facing plugin UI + chat intents; no consumer surface.
- Data/external: RapidRMS API + BOS, Cortex `rapidrms.*`, aros Supabase.

## Execution model
- Owner: one builder per phase; orchestrator sequences.
- Supporting: `journey-council` (pre-design, running), Explore recon (Phase 0,
  running), `app-slice-coherence` + `app-ux-journey` pre-merge,
  `style-reviewer`, `mission-reviewer` pre-execution and before done,
  `journey-walker` on the deployed surface before done.
- Verifier is never the phase builder. Founder approves journey specs and any
  live activation.
- Worktree-first: `~/.shre/worktrees/aros/<phase-slug>`; one phase per branch/PR.

## Contract
- Inputs: frozen Phase 0 field availability; approved Journey Specs; existing
  golden-record layer; existing activation model.
- Outputs: two activatable plugins with owner-adjustable controls; profile
  tables bound to `canonical_id`; honest empty/degraded states; assertions.
- Success signal: an owner activates the plugin and, without help, reaches a
  decision-grade answer — for Item Profile, a min/max recommendation they can
  act on for both a daily-selling and a twice-a-year item; for Customer Profile,
  a truthful repeat-vs-new split — with every figure traceable to real rows.
- Failure signal: a PAN stored anywhere; a second identity-resolution path; a
  number rendered from an unverified contract; a screen that cannot explain
  where its figure came from; horizontal scroll at any width in range.
- Rollback: plugins are activation-gated and additive — deactivate returns the
  tenant to prior behaviour; migrations are additive with RLS from day one.

## Verification
- Local: typecheck; unit tests on the pure analytics (velocity, min/max,
  health banding) with fixtures for a daily seller AND a twice-a-year item;
  RLS negative tests (cross-tenant read returns zero rows).
- Integration: activation provisions and deprovisions cleanly; unauth API 401.
- Real-flow: `journey-walker` completes each golden path on the deployed
  surface as the persona, no help; zero horizontal scroll checked at 320/768/
  1440px.
- Reviewers: mission-reviewer (pre + done), coherence, UX-journey, style.
- Evidence: `docs/missions/evidence/retail-profiles/`.

## Kill criteria
- Phase 0 finds no usable payment identifier → Phase 3 stops for a founder
  decision (do not substitute a guess).
- Any design requiring PAN storage → stop.
- Any design requiring a second canonical-entity system → stop.
- Item min/max guidance cannot be made trustworthy for slow movers → ship the
  history and frequency views WITHOUT a recommendation rather than a guess.

## Handoff
- Current state: CONTRACT DRAFTED. Phase 0 recon RUNNING; Phase 1
  journey-council RUNNING. No code, no schema.
- Open founder questions: does Customer Profile stay owner-side-only (C3), or
  is it intended to converge with REGULARS? Which name should the owner see?
- Memory: `stm-retail-profiles`; cross-ref `stm-customer-fabric-2026-07-17`,
  `stm-aros-automation-rules`.
