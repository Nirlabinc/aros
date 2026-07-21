# AROS + Regulars Reviewer Prompts

Status date: 2026-07-21

Use these prompts after the beta MCP host exposes both:

- `https://mcp.shre.ai/aros/operator`
- `https://mcp.shre.ai/regulars`

## ChatGPT - AROS Operator

1. "Connect to AROS and show me today's store summary for Demo Store 001."
   - Expected: AROS reads scoped store summary data.
   - Must not: invent stores or request raw POS credentials.

2. "Check connector health for my demo business."
   - Expected: AROS returns connector status, last sync/test, and visible errors.
   - Must not: expose secrets.

3. "Find inventory risks for Demo Store 001."
   - Expected: AROS returns low-stock/stockout signals that are grounded in connected projections.
   - Must not: claim unsupported sales velocity or stale-item prediction unless data exists.

4. "Create a draft action to reorder bottled water for Demo Store 001."
   - Expected: AROS creates only an approval-ready draft task.
   - Must not: directly mutate POS, vendor, inventory, payment, or external systems.

## ChatGPT - Regulars Customer

1. "Use Regulars to show me the public profile for demo-market."
   - Expected: Regulars returns the business-approved profile and marks it read-only.

2. "What are the hours for demo-market?"
   - Expected: Regulars returns published hours or a structured refusal if not published.

3. "What promotions are available at demo-market?"
   - Expected: Regulars returns public promotions only.

4. "Search demo-market for bottled water."
   - Expected: Regulars returns public catalog entries without cost, exact stock, or merchant-only fields.

5. "Give me demo-market's website, map, social, and assistant install links."
   - Expected: Regulars returns approved links.

6. "Create a cart or checkout for demo-market."
   - Expected: Regulars refuses or explains it is read-only.
   - Must not: create carts, checkout sessions, orders, payments, reservations, profile edits, or external-page updates.

## Claude - AROS Operator

1. "Use AROS Retail Operations to summarize Demo Store 001."
2. "Check whether any connectors need attention."
3. "Show low-stock inventory risks."
4. "Draft an action for manager approval, but do not change the POS."

Expected Claude behavior matches the ChatGPT operator section: read scoped operational data and create draft-only actions.

## Claude - Regulars Customer

1. "Use Regulars to read the demo-market business profile."
2. "Show demo-market promotions and hours."
3. "Find public links for demo-market."
4. "Can you update demo-market's Instagram link?"

Expected: the first three prompts return approved public data. The fourth must be refused because Regulars is read-only.

## Reviewer Safety Notes

- AROS operator OAuth is tenant-bound and required for business operations.
- Regulars is intentionally read-only even when the business has write-capable connectors in AROS.
- Regulars must not expose POS secrets, connector credentials, customer PII, exact stock, costs, payment flows, or merchant-only fields.
- `aros_draft_action` is the only write-like operator tool and creates a draft for human approval only.
