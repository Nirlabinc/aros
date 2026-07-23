# Journey: Store owner decides whether to reorder an item

**Status:** DRAFT — founder approval required before any schema (mission
`docs/missions/retail-profiles.md`).
**Persona:** Ramesh (`docs/journeys/README.md`).
**Trigger:** he's at the shelf, or a rep is in front of him with a case deal.
The question is literally *"Do I buy this, and how many?"* — and *"is this thing
even still selling?"*
**Entry:** `/marketplace` (Apps tab) → **Items** card. After activation:
**Items** in the workspace nav (`/items`), plus deep links from a low-stock
alert, a chat answer, or the search/scan box.

## Golden path (≤5 steps, ≤3 minutes)
| # | He sees | Must already know | His one action |
|---|---|---|---|
| 1 | Card: **Items** — "Look up any item: how it's selling, what it sells with, how much to keep on the shelf." | nothing | Tap card |
| 2 | Dialog: what it shows, what it needs ("your register, already connected ✅"), what it never does ("we never change anything in your register") | nothing | **Turn on Items** |
| 3 | Card **Active**; **Items** in nav | nothing | **Open** |
| 4 | Big focused search box "Search or scan an item" — **plus a pre-filled short list** so it's never a blank box: "Running out soon (3)", "Hasn't sold in a while (5)" | nothing | Type, tap, or scan |
| 5 | **"Marlboro Gold Box — sold 43 in the last 7 days, about 6 a day. You have 12 left: that's about 2 days."** Then **"Keep at least 30 on the shelf."** Then: last sold · 90-day bar chart · sold on 38 receipts · **usually bought with** · **came in on** (supplier/invoice/case cost) · buyers who came back · **note box** | nothing | Read it (goal reached) |

## The adjustable controls, in his words

**Control 1 — "How often should this sell?"** (item health)
> `Every day` · `Every week` · `Every month` · `A few times a year`
> *We think: **Every week** (it's sold about once a week for 3 months).* [Use that]

- **Default is auto-suggested from the item's own last 90 days**, shown as a
  sentence with one-tap accept. He confirms; he never computes.
- Settable per category in one tap ("Use 'A few times a year' for all of Wine").
- Health reads **Selling fine / Slowing down / Stalled** — never a score. "Stalled"
  means *no sale in longer than the pace he chose*, so a wine selling twice a year
  is never called dead. **This is the founder's core requirement.**
- Not enough history to suggest: "This has only sold 3 times in 6 months — tell us
  how often you expect it to sell." No guess.

**Control 2 — "How long do you want to be covered?"** (stock-hold horizon)
> `2 weeks` · `6 months` · `1 year`

- Default follows control 1 (2 weeks for everyday items, 6 months for "a few times
  a year") so the two never fight.
- Output is **sentences, not fields named Min/Max**: *"Keep at least 30 on the
  shelf."* and *"Don't go past 120 — more than that just sits."*
- When a cap bites, it says so in the same breath: *"we capped this at 120; 2 weeks
  of sales would be 84 but you've never held more than 120."*
- Permanent **"Not right? Set it yourself"** — his numbers always win, are stored,
  and the screen then says *"You set these on 22 July"* instead of showing our math.
- The explaining sentence is always visible: *"Based on selling about 6 a day for
  the last 90 days."* Short window: *"Based on only 6 days of sales — this will get
  better."*

**Control 3 — "Which deal did this come in on?"**
Read from the **EDI Invoices** app (supplier, invoice no, case UPC, case cost, case
qty — and it already has a **Comment** field). Most recent shown with "3 more". A
comment box sits on the deal block, separate from the item note.

## Prior art applied
- **Shopify**: shows **N/A** for days-of-inventory when there were no sales in the
  window — *"we don't have sufficient data to make a prediction."* Steal the
  honesty; replace N/A with a sentence.
- **Lightspeed** ships min/max **and** reorder-point side by side; the same item
  yields two different answers, both labelled "low stock". **Do not inherit that.**
  One model only.
- **Square**: one threshold, one alert, one forecast — closest to what an owner
  will actually maintain. Its real-world complaint is *stale data shown as
  current*, which is why every screen here carries "as of" + **Check now**.
- The industry-standard **28-day window breaks the founder's exact case** (a
  six-month seller has zero sales in 28 days). The adjustable pace is the
  differentiator; the honest degrade is the floor beneath it.

## Failure states
| Step | Goes wrong | Screen says | Recovery |
|---|---|---|---|
| 4 | Catalog not synced | "We haven't pulled your item list yet." + "usually takes a minute" | **Get my items now** (`/api/store/sync`) |
| 4 | Search finds nothing | "Nothing matches 'marlbro'. Try fewer letters, or scan the barcode." | Retype/scan |
| 4 | Barcode not in catalog | "That barcode isn't in your register's item list." | **Search by name** |
| 4 | Camera denied | "Your phone blocked the camera. You can still type the name." | Type — never a dead scan button |
| 5 | **Never sold** | "This has never sold since we started watching (12 June). You have 6 on hand." — no velocity, no min/max, **no N/A cell** | Honest |
| 5 | On-hand unknown | "Sold 43 in 7 days. We don't have a count on hand, so we can't say how many days you have left." | — |
| 5 | <14 days history | Min/max **withheld, not guessed**: "Not enough sales yet to suggest a number." | Time |
| 5 | Per-invoice lines unavailable | "Sold on N receipts" and "Usually bought with" are **absent with a reason**: "Your register doesn't break invoices down by item for us yet." Never zeros | Honest gap |
| 5 | EDI app not activated | "Turn on **EDI Invoices** to see which delivery and which case deal this came in on." | One tap |
| 5b | Min above max | Inline at the field: "The first number should be smaller than the second." No modal | Fix in place |
| 5b | Override save fails | Values stay in inputs + retry | Retry |
| any | Stale | "as of 9:40 AM" + **Check now** | One tap |

## Success signal
On one phone screen, **no horizontal scroll at any width 320–1440px**, he reads a
sentence answering his actual question — *"about 6 a day, you have 12, that's 2
days, keep at least 30"* — sourced to his own register with an "as of" time. Then
he taps `6 months` and **the two numbers visibly change** with the explanation
updating. That change is the proof the control is real.

## Activation dependencies
| Dependency | State | Honest UI until wired |
|---|---|---|
| Item catalog + on-hand + min level | **VERIFIED live** (`GET /api/Item`, `iteM_InStock`, `iteM_MinStockLevel`) | — |
| Units sold per item over a range | **VERIFIED** (`collectTopSoldItems()` off `/api/InvoiceReport`; `/api/SalesDetail/Get` 404s) | — |
| **Per-invoice item lines** (item↔invoice join) | **UNVERIFIED** — `flattenSalesRows()` unnests candidates but no fixture pins the join key | Receipt-count and cross-sell blocks hidden with a stated reason |
| Cost/margin | **PARTIAL** — cost fields exist, dedicated change timestamps do not (`collectItemChanges` already returns `available:false` rather than guessing — copy that) | Margin block hidden with a reason |
| **Deal / group membership** | **VIA EDI, read-verified** (`connectors/rapidrms-edi.ts`; writes blocked server-side) | "Turn on EDI Invoices" |
| Golden product IDs (item survives a SKU/UPC change) | **NOT WIRED** (`STRONG_KEYS.product = ['upc','gtin','sku']` ready) | Keyed on raw item code; history breaks if the code changes — state it or wire it first |
| `entity_note` + owner-override tables (`item_pace`, `item_stock_override`), RLS from migration 1 | Not built | Controls hidden; only observed numbers shown |
| `platform_apps` row + bundle + **409 gate** on `/api/items/*` | Not built | "not installed" + install |
| Freshness | 60s read cache + 6-hourly `store_snapshots`; **not** per-transaction | "as of HH:MM" + **Check now**; never imply live-to-the-second |

## Named performance budgets
`/items` first paint (cached catalog) **<1.0s**; search filter **<200ms**
(client-side); item page P95 **<1.5s** on 4G; changing the horizon control
re-renders from already-fetched data in **<100ms** (no round trip); **zero
horizontal scroll 320–1440px**.

## Out of scope
Writing min/max back to RapidRMS (writes blocked server-side; precedent is
draft-then-approve). Generating purchase orders (`auto-reorder` territory —
decide fold-in or separate). Multi-store comparison. Vendor promo evaluation —
that's `deal-hunter`, **a different meaning of the word "deal"; pick one word**.
