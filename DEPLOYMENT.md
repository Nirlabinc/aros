# Deployment

## App

```text
Name: AROS
Repo: Shreai/aros
Runtime: Node.js >=20, pnpm 9.15.4, Turbo, PM2 on remote hosts
Build command: pnpm build
Dev command: pnpm dev
Serve command: pnpm serve
Deploy workflow: .github/workflows/deploy.yml
```

## Local Development

```powershell
pnpm install
pnpm dev
```

Build:

```powershell
pnpm build
```

Checks:

```powershell
pnpm typecheck
pnpm lint
```

## Environments

GitHub environments already created:

| Environment | URL | Deploy target | Secrets namespace |
|---|---|---|---|
| dev | `https://dev.aros.live` | staging host / `aros-dev` PM2 app | `shre/aros/dev/*` |
| qa-beta | `https://beta.aros.live` | staging host / `aros-beta` PM2 app | `shre/aros/qa-beta/*` |
| production | `https://aros.live` | production host / `aros-prod` PM2 app | `shre/aros/production/*` |

The existing deploy workflow uses `target_env` values:

```text
staging
prod
```

Map those to the platform model:

```text
staging -> qa-beta and dev routes
prod -> production
```

## Deployment Workflow

Manual deploy:

```text
GitHub Actions -> Deploy AROS -> target_env: staging or prod
```

The workflow:

```text
resolves target host
validates runtime ownership
syncs source to /opt/aros-platform
runs pnpm install/build where appropriate
restarts PM2 apps
validates environment mapping
runs route health checks
```

## Required GitHub Secrets

Current deploy workflow expects:

```text
AROS_MAIN_SSH_HOST
AROS_STAGING_SSH_HOST
AROS_SSH_PRIVATE_KEY
```

These should be backed by or migrated to:

```text
shre-secrets :5473
```

Namespace pattern:

```text
shre/aros/<environment>/<secret-name>
```

Examples:

```text
shre/aros/qa-beta/ssh-host
shre/aros/qa-beta/ssh-private-key
shre/aros/production/ssh-host
shre/aros/production/supabase-url
```

## Signup / Access Mode

Recommended current mode:

```text
Signup mode: private beta / customer-specific onboarding
Auth: Shre/AROS auth provider
Public self-signup: disabled until commercial launch
Workspace creation: admin-created
API keys: workspace-scoped only
```

Future public SaaS mode:

```text
email/OAuth signup -> email verification -> workspace creation -> plan/trial gate -> scoped integrations
```

## Release

AROS is currently deployed as a hosted web platform, not as a downloadable app.

Recommended channel model:

```text
feature branches -> CI only
main -> staging candidate
beta tags -> qa-beta release
v* tags -> production release
```

## Rollback

Minimum rollback path:

```text
redeploy previous commit through GitHub Actions
or SSH to host and roll PM2 app back to previous source/release
```

Before broader production use, define:

```text
previous release marker
database rollback/backup process
PM2 rollback command
Cloudflare route rollback
post-rollback smoke checks
```
