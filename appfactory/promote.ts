// ── App Lifecycle Transitions (App Factory Phase 2) ─────────────────────────
// draft → preview → live → retired, enforcing the DECIDED 2026-07-15 policy:
//
//   * draft → preview  — AUTO on smoke pass. Service actor only, and only
//     with smokePassed = true (the build pipeline's callback after the
//     app's smoke.d suite passed). Preview carries no prod traffic.
//   * preview → live   — ALWAYS human-approved. approvedBy (auth.users uuid)
//     is mandatory and is recorded as the actor of the 'promoted' event.
//   * live → retired   — service actor only (container teardown accompanies
//     the row change).
//
// This module is the pipeline-side enforcement; the DB trigger in
// supabase/migrations/20260715_tenant_apps.sql enforces the same rules
// again in Postgres, so neither layer is the only wall.

import type {
  AppFactoryDeps,
  AppStatus,
  TenantApp,
  TransitionContext,
} from './types.js';
import { AppTransitionError } from './types.js';

/** Legal edges of the lifecycle state machine. */
export const LEGAL_TRANSITIONS: Readonly<Record<AppStatus, readonly AppStatus[]>> = {
  draft: ['preview', 'retired'],
  preview: ['live', 'draft', 'retired'],
  live: ['retired'],
  retired: [],
};

/**
 * Validate a transition against the state machine AND the decided policy.
 * Throws AppTransitionError; returns nothing on success.
 */
export function assertTransition(from: AppStatus, to: AppStatus, ctx: TransitionContext): void {
  if (!LEGAL_TRANSITIONS[from]?.includes(to)) {
    throw new AppTransitionError(`illegal transition ${from} -> ${to}`, from, to);
  }

  if (from === 'draft' && to === 'preview') {
    if (ctx.actorType !== 'service') {
      throw new AppTransitionError(
        'draft -> preview is automatic (build pipeline / service actor only)',
        from,
        to,
      );
    }
    if (ctx.smokePassed !== true) {
      throw new AppTransitionError(
        'draft -> preview auto-promotes ONLY on smoke-suite pass (smokePassed must be true)',
        from,
        to,
      );
    }
  }

  if (from === 'preview' && to === 'live') {
    if (!ctx.approvedBy) {
      throw new AppTransitionError(
        'preview -> live is ALWAYS human-approved: approvedBy (auth.users uuid) is required',
        from,
        to,
      );
    }
    if (ctx.actorType !== 'service') {
      throw new AppTransitionError(
        'preview -> live is executed by the deploy pipeline (service actor) carrying the human approval',
        from,
        to,
      );
    }
  }

  if (from === 'live' && to === 'retired' && ctx.actorType !== 'service') {
    throw new AppTransitionError(
      'live -> retired is executed by the deploy pipeline (container teardown must accompany it)',
      from,
      to,
    );
  }
}

async function getApp(deps: AppFactoryDeps, appId: string): Promise<TenantApp> {
  const res = await deps.registry.from('tenant_apps').select().eq('id', appId).single();
  if (res.error || !res.data) {
    throw new Error(`tenant_apps lookup failed for ${appId}: ${res.error?.message ?? 'not found'}`);
  }
  return res.data as TenantApp;
}

/**
 * Perform a lifecycle transition. Policy is asserted here first; the DB
 * trigger re-asserts it and writes the audit event (status_changed /
 * promoted / retired) — this module never writes app_events for
 * transitions, avoiding double audit rows.
 */
export async function transitionApp(
  deps: AppFactoryDeps,
  appId: string,
  to: AppStatus,
  ctx: TransitionContext,
): Promise<TenantApp> {
  const app = await getApp(deps, appId);
  assertTransition(app.status, to, ctx);

  const patch: Record<string, unknown> = { status: to };

  if (to === 'live') {
    // The trigger requires the approver in metadata and records it as the
    // actor of the 'promoted' event; pin the exact beta-passed tag.
    patch.metadata = { ...app.metadata, approved_by: ctx.approvedBy };
    if (ctx.imageVersion) patch.image_version = ctx.imageVersion;
  }

  const updated = await deps.registry
    .from('tenant_apps')
    .update(patch)
    .eq('id', appId)
    .select()
    .single();
  if (updated.error) {
    throw new Error(`tenant_apps transition update failed: ${updated.error.message}`);
  }
  return updated.data as TenantApp;
}

/**
 * Build-pipeline callback: record the smoke pass, then auto-promote
 * draft -> preview. The smoke_passed event is written FIRST because the DB
 * trigger gates draft -> preview on its existence.
 */
export async function promoteToPreview(
  deps: AppFactoryDeps,
  appId: string,
  opts: { detail?: Record<string, unknown> } = {},
): Promise<TenantApp> {
  const app = await getApp(deps, appId);
  const smoke = await deps.registry.from('app_events').insert({
    app_id: appId,
    tenant_id: app.tenant_id,
    event: 'smoke_passed',
    actor_type: 'service',
    detail: opts.detail ?? {},
  });
  if (smoke.error) {
    throw new Error(`app_events(smoke_passed) insert failed: ${smoke.error.message}`);
  }
  return transitionApp(deps, appId, 'preview', {
    actorType: 'service',
    smokePassed: true,
    detail: opts.detail,
  });
}

/**
 * Operator-approved go-live. `approvedBy` is the auth.users uuid of the
 * human who said yes — never optional, never defaulted.
 */
export async function approveGoLive(
  deps: AppFactoryDeps,
  appId: string,
  opts: { approvedBy: string; imageVersion?: string; detail?: Record<string, unknown> },
): Promise<TenantApp> {
  return transitionApp(deps, appId, 'live', {
    actorType: 'service',
    approvedBy: opts.approvedBy,
    imageVersion: opts.imageVersion,
    detail: opts.detail,
  });
}

/** Tenant admin sends a preview back for rework. */
export async function demoteToDraft(
  deps: AppFactoryDeps,
  appId: string,
  ctx: Pick<TransitionContext, 'actorType' | 'actor'>,
): Promise<TenantApp> {
  return transitionApp(deps, appId, 'draft', ctx);
}

/** Retire an app (schema/data kept until an explicit purge much later). */
export async function retireApp(
  deps: AppFactoryDeps,
  appId: string,
  ctx: Pick<TransitionContext, 'actorType' | 'actor' | 'detail'>,
): Promise<TenantApp> {
  return transitionApp(deps, appId, 'retired', ctx);
}
