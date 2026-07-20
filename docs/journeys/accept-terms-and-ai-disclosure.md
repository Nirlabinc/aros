# Journey: Store owner accepts the terms and meets the AI disclosure
Persona: Ramesh (see docs/journeys/README.md) — non-technical store owner
Trigger: First sign-in after the terms gate ships (or after a terms-version bump): Ramesh opens app.aros.live to check on his store.
Entry point: Any authenticated surface (`/start`, `/dashboard`) — the gate overlays whatever he was heading to.

> **Status: BUILT, FLAGGED OFF.** The whole journey is behind the
> `TERMS_GATE_ENABLED` env flag and the legal copy is placeholder pending
> attorney review. Until the flag is set, nothing below is user-visible and
> every existing journey is unchanged. Golden-path E2E: to be recorded on
> beta with the flag enabled, before any production activation (see
> Activation dependencies).

## Golden path (budget: ≤ 5 steps / ≤ 5 minutes)
| # | User sees | Must already know | The ONE action they take |
|---|-----------|-------------------|--------------------------|
| 1 | A single card over the app: "Review and accept our terms", one unchecked checkbox naming the Terms of Service and Privacy Policy links, and a disabled "Agree and continue" button | *(nothing)* | Tick the checkbox |
| 2 | The button becomes active | *(nothing)* | Click "Agree and continue" |
| 3 | The app he was opening, exactly where he was going | *(nothing)* | — (gate never returns for this version) |
| 4 | Before his first chat message: "Before you chat with your AI assistant" popup — plain-language "AI can make mistakes" note with a "Got it" button | *(nothing)* | Click "Got it" |
| 5 | Chat as normal, with a small permanent line under the input: "AI-generated — verify before acting." | *(nothing)* | — |

## Failure states (every way each step can fail)
| Step | What goes wrong | What the screen says | Self-service recovery |
|------|-----------------|----------------------|-----------------------|
| 1 | The Terms/Privacy links are opened before deciding | The legal page opens in a new tab, clearly marked; the gate stays put in the original tab | Close the tab, come back, decide |
| 2 | Network error while recording acceptance | "We could not record your acceptance. Please check your connection and try again." — checkbox state preserved | Tap "Agree and continue" again |
| 2 | Consent backend is down entirely | The API-side gate fails open; the status endpoint reports unknown and the overlay does not brick the app | Retry later; acceptance is demanded again next load |
| 4 | Network error while recording "Got it" | Popup closes anyway (optimistic, cached locally); ack retried on a later session | Nothing to do |
| any | Terms version bumps later | Gate re-appears once with a short "What changed" summary | Re-accept in two taps |

## Empty states
Not applicable — the gate IS the first-run state. A brand-new user sees the
clickwrap before anything else; the AI popup appears only on the first chat
surface they visit.

## Success signal
The overlay is gone, the app is usable, and the chat shows the permanent
"AI-generated — verify before acting." line. Re-loading does not re-prompt.

## Activation dependencies
This journey delivers nothing (by design) until ALL of:
1. Attorney signs off on the Terms of Service + Privacy Policy text.
2. Final legal prose replaces the placeholder DRAFT pages at `/legal/terms`
   and `/legal/privacy` (`apps/web/src/pages/legal/LegalPage.tsx`).
3. `TERMS_VERSION` / `PRIVACY_VERSION` in `src/terms/constants.ts` are bumped
   from `*-draft` to the real effective-date versions.
4. `supabase/migrations/20260717_terms_acceptances.sql` is applied.
5. `TERMS_GATE_ENABLED=1` is set on the platform process.
Until then the UI shows nothing new — honest inertness, not a plausible but
unwired surface. The `/legal/*` pages that ARE reachable early carry an
explicit "DRAFT — pending attorney review" banner.

## Out of scope
- Central-identity (cookie/OIDC) sessions — the pilot auth path has no bearer
  token in the SPA; gate coverage for it lands with that rollout.
- MIB007 chat/council and marketplace MCP connector surfaces (same terms URLs,
  separate repos).
- The Settings → Privacy training-preference toggle the popup references —
  tracked separately; the popup copy ships with counsel-approved text either way.
