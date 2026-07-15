# GitHub Deployment Status

## Direct SSH deployment (preferred when CI is unavailable)

Production can be deployed without GitHub or GitHub Actions from an exact,
committed local snapshot:

```powershell
.\deploy\hostinger\deploy-direct.ps1 -Ref live/direct
```

The command sends a temporary git bundle over SSH, validates production runtime
ownership, installs dependencies, builds, applies the setup migration, restarts
PM2, and gates success on both `/health` and `/readyz`. If any gated step fails,
the remote script restores and rebuilds the previous commit. Runtime-owned
`.env`, `data/`, and `mib007-live/` content is never included in the bundle.

The working tree must be clean so an uncommitted file can never leak into a
release or make the deployed snapshot irreproducible.

This repo now includes a baseline workflow at:

- `.github/workflows/deploy.yml`

## Branch Mapping

- `develop` -> `staging`
- `main` -> `prod`

## Required GitHub Secrets

- `AROS_SSH_PRIVATE_KEY`
- `AROS_MAIN_SSH_HOST`
- `AROS_STAGING_SSH_HOST`

## Runtime Ownership Gate

The workflow runs `deploy/scripts/validate-runtime-ownership.mjs` before SSH deploy to prevent environment mixups:

- `prod` requires:
  - domain `aros.live`
  - Supabase project `ionljrbrvulbmscodtzg`
- `staging` requires:
  - domain `beta.aros.live` or `dev.aros.live`
  - Supabase project `tvdvfdmpackwebfasrsw`

## Protected Runtime Paths

The deploy workflow excludes these paths from `rsync --delete` to avoid
clobbering staging/prod runtime-managed assets:

- `mib007-live/`
- `shre-sdk/`
- `ports.json`

These are currently managed in-place on VPS and must be migrated to a single
repo-owned deployment path before they can be safely included in destructive sync.

## Known Limitation

Current staging PM2 apps (`aros-beta`, `aros-dev`) run from `/opt/aros-platform/mib007-live`, which is not sourced from this repo.  
That path is outside this workflow's controlled source of truth.

To make deployment fully automated end-to-end, either:

1. Move the runtime app source under this repo and deploy it from this workflow.
2. Create a second workflow in the repo that owns `mib007-live` and deploy both repos with explicit promotion gating.
