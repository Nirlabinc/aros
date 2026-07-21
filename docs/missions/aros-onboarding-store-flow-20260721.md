# AROS Onboarding Store Flow 2026-07-21

## Intent
- Outcome: make the live `/onboarding` connect stage use the store-by-store flow: select POS, setup the store, add more store, repeat.
- Why now: the deployed route used a high-level `Connect a store` handoff instead of a guided multi-store setup loop.
- Non-goals: POS credential QA with real secrets, broad onboarding redesign, billing changes, or unrelated deploy-path cleanup.

## Scope
- In: `JourneyPage` connect stage, reusable store setup component, onboarding signal-loading timeout.
- Out: legacy Stripe callback wizard, `/connect` dashboard page, connector backend contract changes.
- Repos/services: AROS web app and live `app.aros.live` bundle.
- Surfaces/users affected: new or mid-journey workspaces at `/onboarding`.
- Data/external systems affected: live source and web assets on `/opt/aros-platform`; no customer POS credentials entered during QA.

## Execution model
- Owner agent: Codex.
- Supporting agents: none.
- Skills/playbooks: Chrome browser control, mission discipline, worktree-first.
- Required permissions: local source edits, VPS source patch/build, read-only live browser verification.
- Required secrets source: none; public build env already present on VPS.
- Worktree/branch: `C:\Users\nirpa\.shre\worktrees\aros\onboarding-store-flow`, branch `fix/onboarding-store-flow`.

## Contract
- Inputs: live route evidence showing `/onboarding` renders `JourneyPage`, plus founder UX direction.
- Expected outputs: source branch, live hot patch, verified public bundle strings, no loading hang.
- Success signal: deployed bundle contains `Set up each store`, `Select POS`, `Setup the store`, `Add more store`; existing connected workspace still reaches readiness.
- Failure signal: `/onboarding` sticks on loading or source/live continue to diverge with no branch.
- Rollback/compensation: VPS backups in `/opt/aros-platform/.codex-backups/onboarding-store-flow-20260721/`.

## Verification
- Local gate: `pnpm --filter @aros/web typecheck` passed.
- Integration gate: `pnpm --filter @aros/web build` passed.
- Real-flow smoke/E2E: live `https://app.aros.live/onboarding` served bundle `/assets/index-CYpgw9Xm.js` containing the new store-flow strings and timeout; existing connected workspace settled to readiness with no console errors.
- Reviewer agents: not used.
- Evidence location: final response and this file.

## Handoff
- Current state: live hot patch applied and source branch prepared.
- Remaining gaps: run a brand-new QA workspace through the connect stage with test credentials to validate connector-save behavior end to end.
- Follow-up queue: reconcile live/direct-deploy with `main` normally so future deploys do not lose hot patches.
- Memory/update target: `.claude/projects/C--Users-nirpa/memory/stm_aros_validation_sweep_2026-07-21.md`.
