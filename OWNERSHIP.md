# Ownership

## Identity

```text
App name: AROS
Full name: Agentic Retail Operating System
GitHub owner/repo: Shreai/aros
Business owner: Shre AI
Technical owner: Shre AI / AROS platform owner
Product family: aros-retail
App type: web-app / retail operating platform
Visibility: public source, proprietary license
Status: active
```

## Environments

```text
Dev URL: https://dev.aros.live
QA/Beta URL: https://beta.aros.live
Production URL: https://aros.live
Download URL: Not a downloadable app by default
```

## Operations

```text
Deployment target: VPS/PM2 via GitHub Actions deploy workflow
Secrets namespace: shre/aros
Logs: PM2 logs on deployment hosts and GitHub Actions logs
Monitoring: deploy workflow health checks and public route smoke checks
Rollback owner: Shre AI / AROS platform owner
Support contact: Shre AI / AROS platform owner
```

## Data

```text
Data classification: customer retail operations and business intelligence data
Production database: production Supabase project configured in deployment workflow
Backup location: TBD per Supabase/host backup policy
Retention policy: TBD before broader production rollout
```

## Repo Notes

`Nirpat3/aros` was transferred to `Shreai/aros` on 2026-07-07 and is now the
canonical AROS source repository. Older public copies remain under `Nirlabinc`
and `RapidInfosoft` until branch/release comparisons are complete.
