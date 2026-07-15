// ── App Factory Types (Phase 2 — tenant app substrate) ─────────────────────
// Registry-backed lifecycle for GENERATED per-tenant apps hosted on
// *.apps.aros.live. Companion migration:
//   supabase/migrations/20260715_tenant_apps.sql
// Design: shreai docs/projects/APP-FACTORY-TENANT-SUBSTRATE.md

/** Lifecycle states — mirrors the tenant_apps_status_check constraint. */
export type AppStatus = 'draft' | 'preview' | 'live' | 'retired';

/** Who performed a lifecycle action — mirrors app_events_actor_type_check. */
export type ActorType = 'user' | 'service' | 'system';

/** app_events.event values — mirrors app_events_event_check. */
export type AppEventName =
  | 'created'
  | 'build_started'
  | 'build_succeeded'
  | 'build_failed'
  | 'preview_deployed'
  | 'smoke_passed'
  | 'smoke_failed'
  | 'promoted'
  | 'rolled_back'
  | 'retired'
  | 'status_changed';

/** One row in public.tenant_apps. */
export interface TenantApp {
  id: string;
  tenant_id: string;
  slug: string;
  display_name: string;
  description: string | null;
  image_ref: string | null;
  image_version: string | null;
  status: AppStatus;
  db_schema: string;
  subdomain: string;
  created_by: string | null;
  /** Monthly hosting fee in cents, billed only while status = 'live'
   *  (previews are free — DECIDED 2026-07-15). 0 = unpriced/included. */
  hosting_fee_cents: number;
  /** Cumulative metered LLM build spend, in credits (DECIDED 2026-07-15). */
  build_credits_used: number;
  promoted_at: string | null;
  retired_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/** One row in public.app_events (append-only). */
export interface AppEvent {
  id?: string;
  app_id: string;
  tenant_id: string;
  event: AppEventName;
  from_status?: AppStatus | null;
  to_status?: AppStatus | null;
  actor?: string | null;
  actor_type: ActorType;
  detail?: Record<string, unknown>;
  created_at?: string;
}

// ── Provisioning ────────────────────────────────────────────────────────────

export interface ProvisionAppInput {
  tenantId: string;
  /** Tenant-scoped identifier; DNS-safe, 3–40 chars. */
  slug: string;
  displayName: string;
  description?: string;
  /** Host label under apps.aros.live; defaults to slug. Globally unique. */
  subdomain?: string;
  /** auth.users uuid of the requesting human (factory acts on their behalf). */
  createdBy?: string;
  /** Monthly hosting fee in cents once live (previews free). Default 0. */
  hostingFeeCents?: number;
  /** Spec hash / factory flow id / resource caps — jsonb escape hatch. */
  metadata?: Record<string, unknown>;
}

export interface ProvisionResult {
  app: TenantApp;
  /** The per-app Postgres schema, app_<8hex> of the app id. */
  schema: string;
  /** The per-app service role (LOGIN NOINHERIT, USAGE on own schema only). */
  role: string;
  /** Generated role password — store in the vault (OpenBao), inject as env
   *  at container launch. NEVER write to the registry or bake into images. */
  rolePassword: string;
  /** The exact DDL that was executed (for audit / dry-run inspection). */
  sql: string;
}

// ── Lifecycle transitions ───────────────────────────────────────────────────

export interface TransitionContext {
  /** Who is asking. The deploy pipeline is 'service'. */
  actorType: ActorType;
  /** auth.users uuid of the human actor, when actorType = 'user'. */
  actor?: string;
  /** draft→preview only: set true by the build pipeline after the app's
   *  smoke suite passed. Auto-promote is ONLY allowed on smoke pass. */
  smokePassed?: boolean;
  /** preview→live only: auth.users uuid of the approving human.
   *  ALWAYS required — promotion to live is never automatic. */
  approvedBy?: string;
  /** Exact registry tag being promoted (pin), e.g. apps/<sub>:20260715a. */
  imageVersion?: string;
  /** Free-form event detail (smoke output path, deploy id, …). */
  detail?: Record<string, unknown>;
}

export class AppTransitionError extends Error {
  constructor(
    message: string,
    readonly from: AppStatus,
    readonly to: AppStatus,
  ) {
    super(message);
    this.name = 'AppTransitionError';
  }
}

// ── Thin DB seams (mockable in tests) ───────────────────────────────────────

/**
 * Executes raw DDL/SQL against the tenant's Postgres (Supabase project) with
 * a privileged connection. Implemented with the same `pg` pool pattern as
 * connectors/rapidrms/analytics-connector.ts; injected so unit tests mock it.
 */
export interface SqlExecutor {
  exec(sql: string): Promise<void>;
}

/** The minimal slice of the Supabase service-role client the factory uses
 *  (matches @supabase/supabase-js — src/supabase.ts createSupabaseAdmin()). */
export interface RegistryClient {
  from(table: string): RegistryTable;
}

export interface RegistryTable {
  insert(values: Record<string, unknown>): RegistryFilter;
  update(values: Record<string, unknown>): RegistryFilter;
  delete(): RegistryFilter;
  select(columns?: string): RegistryFilter;
}

export interface RegistryFilter {
  eq(column: string, value: unknown): RegistryFilter;
  select(columns?: string): RegistryFilter;
  single(): PromiseLike<{ data: unknown; error: { message: string } | null }>;
  maybeSingle(): PromiseLike<{ data: unknown; error: { message: string } | null }>;
  then<R>(
    onfulfilled?: (value: { data: unknown; error: { message: string } | null }) => R,
  ): PromiseLike<R>;
}

/** Dependencies for provisioning / lifecycle ops. */
export interface AppFactoryDeps {
  /** Service-role Supabase client (bypasses RLS; pipeline-side only). */
  registry: RegistryClient;
  /** Privileged SQL executor for schema/role DDL. */
  sql: SqlExecutor;
}
