# Journey: Something went wrong and the store owner gets unstuck alone
Persona: Ramesh (see README.md) — now mildly annoyed.
Trigger: Any failure inside journeys 1–4: a login that won't work, a
connection test that fails, a chat that errors, a dashboard that won't load.
Entry point: The failure itself, wherever it happens.

This journey is cross-cutting: it is the contract every OTHER journey's
failure rows must satisfy. Ramesh does not file bugs and does not email
support on the first failure — he either recovers in the UI in under a
minute, or he leaves.

## Golden path (budget: ≤ 2 steps from any failure back to progress)
| # | User sees | Must already know | The ONE action they take |
|---|-----------|-------------------|--------------------------|
| 1 | What happened, in his words ("RapidRMS didn't accept that login"), never a code, stack trace, or "something went wrong" | *nothing* | Reads the one line |
| 2 | The one obvious way forward: a **Retry** / **Fix it** / **Resend** / **Reset password** button right there | *nothing* | Taps it |
| 3 | Back on the golden path, with everything he'd typed still there | *nothing* | (Recovered) |

## The recovery contract (every failure in every journey)
| Rule | Meaning |
|------|---------|
| Named, not coded | The message says what failed in plain words. `500`, `ECONNREFUSED`, `psql: command not found`, raw JSON — each of these has shipped to users and each is a defect. |
| Blame honestly | If it's on our side, say so ("our fault, try again in a minute"); if it's their input, point at the exact field. |
| Preserve everything typed | A failed submit never clears the form. Recovery re-uses the draft. |
| One-tap forward | The recovery action is on the failure screen itself — never "go back and try again". |
| Resumable | Leaving and coming back lands him where he left off (resumable journey state), not at step 1. |
| Dead ends are defects | Any state whose only exits are the browser back button or "contact us" fails this journey. |
| Escalation is last, and easy | When self-service truly can't fix it (account lockout, data corruption), the contact path is one tap and pre-fills the context — he never re-explains what happened. |

## Failure states (of recovery itself)
| What goes wrong | What the screen says | Self-service recovery |
|-----------------|----------------------|-----------------------|
| Retry fails repeatedly | Escalating honesty: "still not working — we've been notified", with the pre-filled contact path | The escalation hatch |
| Password reset email doesn't arrive | Resend + the address it went to (`/reset-password`) | Resend / correct address |
| He's lost ("where am I?") | Persistent nav home; the logo always goes somewhere sane | One tap home |

## Empty states
Not applicable — this journey has no first-run state.

## Success signal
Ramesh recovers without contacting anyone, keeps what he typed, and — the
real signal — still opens the app the next morning (journey 4).

## Activation dependencies
None of its own; it inherits every other journey's. But: error-message
copy is a **product surface** here, so raw upstream errors (router, POS
APIs, database) must be translated at the boundary — an unfiltered
passthrough is a defect even when technically "informative".

## Out of scope
Status page / incident comms, in-app support chat staffing.
