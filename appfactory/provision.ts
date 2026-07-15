// ── App Provisioner (App Factory Phase 2) ───────────────────────────────────
// Creates the registry row + the app's private Postgres schema + a per-app
// service role with USAGE on its own schema ONLY. Generated apps never touch
// shre/AROS platform tables — that is enforced here at the role level, not
// left to generated code.
//
// Companion migration: supabase/migrations/20260715_tenant_apps.sql
// Design: shreai docs/projects/APP-FACTORY-TENANT-SUBSTRATE.md §3

import { randomBytes, randomUUID } from 'node:crypto';
import type {
  AppFactoryDeps,
  ProvisionAppInput,
  ProvisionResult,
  TenantApp,
} from './types.js';

// Mirror of the migration CHECK constraints — fail fast, before any DDL.
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const SUBDOMAIN_RE = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const SCHEMA_RE = /^app_[a-z0-9_]{4,48}$/;

/** Derive the app's private schema name: app_<first 8 hex of the uuid>. */
export function appSchemaName(appId: string): string {
  const hex = appId.replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) {
    throw new Error(`appSchemaName: not a uuid: ${appId}`);
  }
  return `app_${hex.slice(0, 8)}`;
}

/** The app's dedicated Postgres login role. */
export function appRoleName(schema: string): string {
  assertSchema(schema);
  return `${schema}_svc`;
}

/** Container-name contract used by the *.apps.aros.live wildcard ingress. */
export function containerName(subdomain: string, preview = false): string {
  if (!SUBDOMAIN_RE.test(subdomain)) {
    throw new Error(`containerName: invalid subdomain: ${subdomain}`);
  }
  return preview ? `app-${subdomain}-beta` : `app-${subdomain}`;
}

function assertSchema(schema: string): void {
  if (!SCHEMA_RE.test(schema)) {
    throw new Error(`invalid app schema name: ${schema}`);
  }
}

/** Random credential for the per-app role — return-once, vault-bound. */
export function generateRolePassword(): string {
  return randomBytes(24).toString('base64url');
}

/**
 * DDL template for the app's schema + scoped role.
 *
 * The role gets USAGE + table DML on its own schema and NOTHING else: no
 * USAGE on public is ever granted, and the explicit REVOKEs strip the
 * default PUBLIC grants — platform tables stay unreachable even if generated
 * code is malicious or buggy (defense in depth on top of RLS).
 *
 * Identifiers are validated against the same regexes as the migration CHECK
 * constraints (no quoting tricks possible); the password is the only literal.
 */
export function renderProvisionSql(schema: string, role: string, password: string): string {
  assertSchema(schema);
  if (role !== `${schema}_svc`) {
    throw new Error(`role must be ${schema}_svc, got: ${role}`);
  }
  const pw = password.replace(/'/g, "''");
  return `
-- App Factory Phase 2: per-app schema + scoped role (generated)
CREATE SCHEMA IF NOT EXISTS ${schema};

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
    CREATE ROLE ${role} LOGIN NOINHERIT PASSWORD '${pw}';
  ELSE
    ALTER ROLE ${role} WITH LOGIN NOINHERIT PASSWORD '${pw}';
  END IF;
END
$$;

-- Own schema: full DML, nothing structural beyond it.
GRANT USAGE ON SCHEMA ${schema} TO ${role};
ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema}
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${role};
ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema}
  GRANT USAGE, SELECT ON SEQUENCES TO ${role};

-- Everything else: explicitly walled off (platform tables live in public).
REVOKE ALL ON SCHEMA public FROM ${role};
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${role};
ALTER ROLE ${role} SET search_path = ${schema};
`.trimStart();
}

/**
 * Provision a generated app: registry row (status 'draft') + schema + role.
 *
 * Order matters: the row is inserted first (reserving slug/subdomain/schema
 * uniqueness transactionally), then the DDL runs; if the DDL fails the row
 * is rolled back — no app_events row exists yet, so the delete is legal
 * (app_events' append-only trigger blocks deletes once history exists).
 *
 * The returned rolePassword must go straight to the vault (OpenBao) and be
 * injected as env at container launch — it is never persisted here.
 */
export async function provisionApp(
  deps: AppFactoryDeps,
  input: ProvisionAppInput,
): Promise<ProvisionResult> {
  const slug = input.slug.toLowerCase();
  const subdomain = (input.subdomain ?? slug).toLowerCase();
  if (!SLUG_RE.test(slug)) throw new Error(`invalid app slug: ${input.slug}`);
  if (!SUBDOMAIN_RE.test(subdomain)) throw new Error(`invalid subdomain: ${subdomain}`);
  if ((input.hostingFeeCents ?? 0) < 0) throw new Error('hostingFeeCents must be >= 0');

  const id = randomUUID();
  const schema = appSchemaName(id);
  const role = appRoleName(schema);
  const rolePassword = generateRolePassword();
  const sql = renderProvisionSql(schema, role, rolePassword);

  const inserted = await deps.registry
    .from('tenant_apps')
    .insert({
      id,
      tenant_id: input.tenantId,
      slug,
      display_name: input.displayName,
      description: input.description ?? null,
      status: 'draft',
      db_schema: schema,
      subdomain,
      created_by: input.createdBy ?? null,
      hosting_fee_cents: input.hostingFeeCents ?? 0,
      build_credits_used: 0,
      metadata: input.metadata ?? {},
    })
    .select()
    .single();
  if (inserted.error) {
    throw new Error(`tenant_apps insert failed: ${inserted.error.message}`);
  }
  const app = inserted.data as TenantApp;

  try {
    await deps.sql.exec(sql);
  } catch (err) {
    // Roll the registry back — no events yet, so delete is permitted.
    await deps.registry.from('tenant_apps').delete().eq('id', id);
    throw new Error(
      `schema provisioning failed for ${schema} (registry row rolled back): ` +
        (err instanceof Error ? err.message : String(err)),
    );
  }

  const created = await deps.registry.from('app_events').insert({
    app_id: id,
    tenant_id: input.tenantId,
    event: 'created',
    to_status: 'draft',
    actor: input.createdBy ?? null,
    actor_type: input.createdBy ? 'user' : 'service',
    detail: { db_schema: schema, subdomain, role },
  });
  if (created.error) {
    throw new Error(`app_events(created) insert failed: ${created.error.message}`);
  }

  return { app, schema, role, rolePassword, sql };
}

/**
 * Record metered LLM build spend against the app (build-credits billing,
 * DECIDED 2026-07-15). Additive only; the registry column is cumulative.
 */
export async function addBuildCredits(
  deps: AppFactoryDeps,
  appId: string,
  credits: number,
): Promise<number> {
  if (!Number.isFinite(credits) || credits <= 0) {
    throw new Error('credits must be a positive number');
  }
  const current = await deps.registry
    .from('tenant_apps')
    .select('build_credits_used')
    .eq('id', appId)
    .single();
  if (current.error) {
    throw new Error(`tenant_apps lookup failed: ${current.error.message}`);
  }
  const used = (current.data as { build_credits_used: number }).build_credits_used + credits;
  const updated = await deps.registry
    .from('tenant_apps')
    .update({ build_credits_used: used })
    .eq('id', appId);
  if (updated.error) {
    throw new Error(`build_credits_used update failed: ${updated.error.message}`);
  }
  return used;
}
