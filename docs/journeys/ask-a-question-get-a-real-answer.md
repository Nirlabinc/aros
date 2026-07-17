# Journey: Store owner asks a question and gets a real, honest answer
Persona: Ramesh (see README.md)
Trigger: A question pops into his head between customers: "What did I sell
yesterday?" "What's running low?" "Who was my best seller this month?"
Entry point: The chat surface — the default screen of the signed-in app
(chat-first shell), or the chat inside `/start` pre-connection.

## Golden path (budget: 1 step / ≤ 15 seconds to first useful content)
| # | User sees | Must already know | The ONE action they take |
|---|-----------|-------------------|--------------------------|
| 1 | A chat box with 1–2 subtle suggested questions | *nothing* | Types (or taps) his question |
| 2 | A short in-flight state, then an answer with **his real numbers**, readably formatted, with a small line showing where it came from ("from your RapidRMS sales data") | *nothing* | (Goal reached — maybe a follow-up question) |

## Failure states
| Step | What goes wrong | What the screen says | Self-service recovery |
|------|-----------------|----------------------|-----------------------|
| 2 | Store not connected yet | "I don't have your store's data yet — connect your store and I can answer that" + **Connect** button | One tap to `/connect` (journey 2) |
| 2 | Data source down / query failed | "I couldn't reach your sales data just now — try again in a minute." **Never a made-up number. Never a raw error string.** | Retry; if persistent, status honestly shown |
| 2 | Question outside what it can do | Says so plainly + offers the nearest thing it CAN answer | He rephrases or taps the offer |
| 2 | Answer is slow (>10s) | Progressive in-flight state ("checking your sales…"), not a frozen screen | Waits or asks something else; no double-fire on retry |

## Empty states
Pre-connection, the chat answers from the labeled sample store (journey 1)
and every answer carries the sample label + connect CTA. It must never blur
the line between sample and real.

## Success signal
The number on screen matches what Ramesh can verify at his register, and the
answer says where it came from. Trust is the product: **one fabricated
number ends this journey permanently.**

## Activation dependencies
- `/v1/chat` proxy → shre-router with the tenant mapped (registry entry,
  company_id resolution, Cortex creds) — the full activation contract.
- Tool loop returning **tool-sourced** data (`_shre.toolsUsed` non-empty for
  data questions); UI renders agent/tool attribution from
  `_shre.decisionTrace`, not a hardcoded label.
- Anti-fabrication: when tools fail or return nothing, the model must say so.
  A plausible answer with no tool provenance on a data question is a
  **defect** (this shipped: fabricated $4,827 sales, hardcoded mock
  responses, "(+24% vs last week)" invented on top of real numbers).
- Until the tenant's data path is wired on an environment, chat must answer
  data questions with the honest not-connected state — never fall through to
  a bare model that guesses.

## Out of scope
Taking actions from chat (ordering, price changes — future journeys),
multi-store aggregation, document upload (invoice ingestion journey).
