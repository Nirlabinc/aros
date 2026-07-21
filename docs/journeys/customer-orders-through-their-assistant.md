# Journey: A customer shops a store through their AI assistant
Persona: Dana — a Star Mart regular. Not an operator; has never seen AROS.
Uses Claude (or ChatGPT/Gemini) daily. Knows only the store's name.
Trigger: "What's on sale at Star Mart?" / "Is [item] in stock?" / "Grab me
a coffee for pickup" — asked in her assistant, mid-commute.
Entry point: the assistant calls the Tally/AROS customer MCP surface
(`/aros/customer`), which calls `/api/public/businesses/{slug}/*` on the
AROS API. Dana never sees a URL; the assistant is the whole UI.

## Golden path (budget: 1 message / ≤ 5 seconds per answer)
| # | User sees | Must already know | The ONE action they take |
|---|-----------|-------------------|--------------------------|
| 1 | Asks "what's on sale at Star Mart?" → assistant lists the store's real, current promotions (sponsored ones labeled) | the store's name | Ask the question |
| 2 | Asks "do they have [item]?" → real answer with price and coarse availability ("in stock / running low / out") | *nothing* | Ask |
| 3 | "When do they close?" → real hours for the store, in its timezone | *nothing* | Ask |
| 4 | "Start me an order: large coffee + banana" → a priced cart draft with subtotal and an honest note that payment happens at pickup (Phase 1) | *nothing* | Confirm the items |
| 5 | Checkout → a draft order confirmation stating clearly that in-chat payment is not yet enabled and pickup/pay at the counter completes it | *nothing* | (Goal reached — informed, order drafted) |

## Failure states
| Step | What goes wrong | What the response says | Self-service recovery |
|------|-----------------|------------------------|-----------------------|
| any | Business slug unknown | Structured refusal: "I don't have a business called X" — never invents a store | Ask with the store's code or exact name |
| 2 | Item not in the catalog | "That store's catalog doesn't list [item]" — a refusal, not a guess | Ask for similar items (search is fuzzy on name) |
| 1 | Store has no active promotions | "No promotions running right now" — empty is stated as empty | — |
| 3 | Hours not yet provided by the store | "This store hasn't published hours yet" — honest gap, no invented hours | Store fixes in onboarding; customer can call |
| any | Data snapshot stale | Every answer carries `asOf`; assistant can say "as of 9:40 AM" | — |
| any | Too many requests (abuse) | 429 with Retry-After; assistant backs off | Wait; normal usage never hits the limit |

## Empty states
A just-activated store with a synced catalog but no promotions/hours answers
truthfully per-endpoint: real products, "no promotions yet", "hours not
published yet". Partial activation is stated, never papered over.

## Success signal
Dana gets a correct, current answer in one message — and every fact in it
(price, availability bucket, promotion, hours) traces to a row in the
store's synced data. Zero fabricated fields; refusals where data is absent.

## Activation dependencies
- `public_products_v` view over `pos_inventory_snapshot` (strict projection:
  no cost, no exact counts — quantized availability only).
- `public_promotions` rows for the store (seeded for demo; imported from
  POS discounts for real tenants).
- `stores.metadata.hours` populated (onboarding step).
- Gateway env: `AROS_API_BASE` set; demo mode off. Demo tenant
  `demo-market` responses are labeled `source: synthetic_demo`.

## Out of scope
Identity linking, memberships/loyalty, personalization, in-chat payment
(Phase 2+); operator surfaces; non-US.
