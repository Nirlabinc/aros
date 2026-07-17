# Journey: New store owner signs up and sees value in the first five minutes
Persona: Ramesh (see README.md)
Trigger: Heard about AROS from a peer or a rep; wants to see what it actually
does for a store like his before he invests any real effort.
Entry point: `https://app.aros.live/` (public landing page)

## Golden path (budget: ≤ 5 steps / ≤ 5 minutes)
| # | User sees | Must already know | The ONE action they take |
|---|-----------|-------------------|--------------------------|
| 1 | Landing page: what AROS does for a store, in one screen | *nothing* | Tap **Sign up** / **Get started** |
| 2 | Signup form: email + password, nothing else required | his email address | Submit the form |
| 3 | "Check your email" screen naming the exact address | how to open his email | Tap the verification link / enter the code (`/verify-email`) |
| 4 | `/start` — a chat on a **sample store, labeled as sample**, with tappable example questions | *nothing* | Tap an example question (e.g. "What were sales yesterday?") |
| 5 | A real-feeling answer with numbers, charts, or a briefing — plus a clear **"Connect your store"** CTA | *nothing* | (Goal reached — next journey begins if he taps the CTA) |

## Failure states
| Step | What goes wrong | What the screen says | Self-service recovery |
|------|-----------------|----------------------|-----------------------|
| 2 | Email already registered | "You already have an account" | One-tap link to **Log in** / **Reset password** |
| 2 | Weak password / invalid email | Inline, per-field, plain words | Fix the field; typed input preserved |
| 3 | Verification email never arrives | The address it was sent to + **Resend** button | Resend; option to correct a mistyped email |
| 3 | Link/code expired | "That link expired" | One tap to send a fresh one |
| 4 | Demo backend down | "Our demo is having trouble — try again in a minute" | Retry; signup is not lost, session persists |
| any | Session/auth hiccup mid-flow | Never a blank screen or infinite spinner | Re-entry lands where he left off (resumable journey, `onboarding/journey.ts`) |

## Empty states
The brand-new account IS the empty state: `/start` must load the sample store
instantly — pre-populated demo, labeled as sample data, with suggested
questions. A blank chat with a bare input box is a failure of this journey.

## Success signal
Within five minutes of first visit, Ramesh has read an answer about a store
(sample, and labeled so) that made him think "I want this for MY numbers" —
and the path to do that (**Connect your store**) is on the screen he's
already looking at.

## Activation dependencies
- Email delivery (OTP/verification sender) configured and not landing in spam.
- Demo tenant + sample dataset behind `/start` seeded and served
  (`/v1/demo/*` path live).
- Until the demo backend is wired on an environment, `/start` must say the
  demo is unavailable — never render an empty or fabricated chat.

## Out of scope
Plan selection / billing (legacy wizard, Stripe round-trip), team invites,
connecting the real store (journey 2).
