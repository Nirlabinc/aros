# Journey: Store owner updates their own account (name / password)
Persona: Ramesh (see README.md)
Trigger: His name shows wrong in the corner, or he wants a new password.
Entry point: Avatar (top right) → **Profile** under Account (`/profile`).

## Golden path (budget: ≤ 3 steps / ≤ 1 minute)
| # | User sees | Must already know | The ONE action they take |
|---|-----------|-------------------|--------------------------|
| 1 | Profile page: who he's signed in as, his workspace, a name field, a change-password form | *nothing* | Edit the field he came for |
| 2 | Plain-language validation as he types wrong things ("at least 10 characters, letters + a number") | *nothing* | Tap **Save name** / **Change password** |
| 3 | A "Saved" confirmation stating exactly what changed and when it takes effect | *nothing* | (Goal reached) |

## Failure states
| Step | What goes wrong | What the screen says | Self-service recovery |
|------|-----------------|----------------------|-----------------------|
| 2 | Weak/mismatched password | The specific rule that failed, before any network call | Fix and resubmit; typed input preserved |
| 2 | Empty name | "Name cannot be empty." | Type a name |
| 2 | Auth backend rejects | The backend's error verbatim in the attention note | Retry |
| any | Workspace uses shre-id (central identity) | "Managed by shre-id" card with an **Open shre-id** button — no dead forms | One tap to the right place |

## Empty states
A user with no display name set sees an empty name field with a placeholder,
not a fabricated name.

## Success signal
The "Saved" note says what changed; the new name appears in the avatar/user
row after refresh (the note says so honestly).

## Activation dependencies
None — Supabase auth `updateUser` is already live for password/metadata.
Central-identity workspaces route to shre-id instead of showing dead forms.

## Out of scope
- Email change (requires re-verification flow — documented on the page as
  support-assisted for now).
- Sessions & Devices (its own page), workspace settings, roles.
