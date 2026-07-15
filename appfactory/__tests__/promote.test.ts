import { describe, expect, it } from 'vitest';
import {
  approveGoLive,
  assertTransition,
  demoteToDraft,
  LEGAL_TRANSITIONS,
  promoteToPreview,
  retireApp,
  transitionApp,
} from '../promote.js';
import { AppTransitionError, type AppStatus } from '../types.js';
import { makeDb, makeRegistry, makeSql, type MockDb } from './helpers.js';

const SERVICE = { actorType: 'service' as const };
const USER = { actorType: 'user' as const, actor: 'user-1' };

function seedApp(db: MockDb, status: AppStatus = 'draft'): Record<string, unknown> {
  const app = {
    id: 'app-1',
    tenant_id: 'tenant-1',
    slug: 'shift-planner',
    status,
    metadata: {} as Record<string, unknown>,
    image_version: null,
  };
  db.tables.tenant_apps.push(app);
  return app;
}

function deps(db: MockDb) {
  return { registry: makeRegistry(db), sql: makeSql() };
}

describe('assertTransition — state machine', () => {
  it('rejects every illegal edge', () => {
    const statuses: AppStatus[] = ['draft', 'preview', 'live', 'retired'];
    for (const from of statuses) {
      for (const to of statuses) {
        if (from === to || LEGAL_TRANSITIONS[from].includes(to)) continue;
        expect(() => assertTransition(from, to, SERVICE)).toThrow(AppTransitionError);
      }
    }
    // retired is terminal
    expect(LEGAL_TRANSITIONS.retired).toHaveLength(0);
  });
});

describe('assertTransition — DECIDED 2026-07-15 policy', () => {
  it('draft -> preview: auto for service actor on smoke pass', () => {
    expect(() =>
      assertTransition('draft', 'preview', { ...SERVICE, smokePassed: true }),
    ).not.toThrow();
  });

  it('draft -> preview: refused without a smoke pass', () => {
    expect(() => assertTransition('draft', 'preview', SERVICE)).toThrow(/smoke-suite pass/);
    expect(() => assertTransition('draft', 'preview', { ...SERVICE, smokePassed: false })).toThrow(
      /smoke-suite pass/,
    );
  });

  it('draft -> preview: refused for human actors (pipeline-only)', () => {
    expect(() => assertTransition('draft', 'preview', { ...USER, smokePassed: true })).toThrow(
      /service actor only/,
    );
  });

  it('preview -> live: ALWAYS requires a human approver', () => {
    expect(() => assertTransition('preview', 'live', SERVICE)).toThrow(/human-approved/);
    expect(() =>
      assertTransition('preview', 'live', { ...SERVICE, approvedBy: 'user-1' }),
    ).not.toThrow();
  });

  it('preview -> live: a human session cannot promote directly, even the approver', () => {
    expect(() => assertTransition('preview', 'live', { ...USER, approvedBy: 'user-1' })).toThrow(
      /deploy pipeline/,
    );
  });

  it('preview -> draft (rework) is open to tenant admins', () => {
    expect(() => assertTransition('preview', 'draft', USER)).not.toThrow();
  });

  it('live -> retired: pipeline only (teardown accompanies it)', () => {
    expect(() => assertTransition('live', 'retired', USER)).toThrow(/deploy pipeline/);
    expect(() => assertTransition('live', 'retired', SERVICE)).not.toThrow();
  });

  it('draft/preview -> retired (abandon) is open to tenant admins', () => {
    expect(() => assertTransition('draft', 'retired', USER)).not.toThrow();
    expect(() => assertTransition('preview', 'retired', USER)).not.toThrow();
  });
});

describe('promoteToPreview', () => {
  it('writes smoke_passed BEFORE the status flip (DB trigger gates on it)', async () => {
    const db = makeDb();
    seedApp(db, 'draft');
    const app = await promoteToPreview(deps(db), 'app-1', { detail: { report: 's3://smoke/1' } });

    expect(app.status).toBe('preview');
    expect(db.tables.app_events).toHaveLength(1);
    expect(db.tables.app_events[0]!.event).toBe('smoke_passed');
    expect(db.tables.app_events[0]!.actor_type).toBe('service');
    const smokeIdx = db.ops.indexOf('insert:app_events');
    const updateIdx = db.ops.indexOf('update:tenant_apps');
    expect(smokeIdx).toBeGreaterThanOrEqual(0);
    expect(updateIdx).toBeGreaterThan(smokeIdx);
  });

  it('refuses when the app is not in draft', async () => {
    const db = makeDb();
    seedApp(db, 'live');
    await expect(promoteToPreview(deps(db), 'app-1')).rejects.toThrow(AppTransitionError);
  });
});

describe('approveGoLive', () => {
  it('records the human approver in metadata and pins the image tag', async () => {
    const db = makeDb();
    seedApp(db, 'preview');
    const app = await approveGoLive(deps(db), 'app-1', {
      approvedBy: 'user-42',
      imageVersion: 'apps/shift-planner:20260715a',
    });
    expect(app.status).toBe('live');
    expect((app.metadata as Record<string, unknown>).approved_by).toBe('user-42');
    expect(app.image_version).toBe('apps/shift-planner:20260715a');
  });

  it('never defaults the approver', async () => {
    const db = makeDb();
    seedApp(db, 'preview');
    await expect(
      // @ts-expect-error — approvedBy is mandatory
      approveGoLive(deps(db), 'app-1', {}),
    ).rejects.toThrow(/human-approved/);
    expect(db.tables.tenant_apps[0]!.status).toBe('preview');
  });
});

describe('demote / retire / errors', () => {
  it('demoteToDraft sends a preview back for rework', async () => {
    const db = makeDb();
    seedApp(db, 'preview');
    const app = await demoteToDraft(deps(db), 'app-1', USER);
    expect(app.status).toBe('draft');
  });

  it('retireApp retires a preview app for a tenant admin', async () => {
    const db = makeDb();
    seedApp(db, 'preview');
    const app = await retireApp(deps(db), 'app-1', USER);
    expect(app.status).toBe('retired');
  });

  it('transitionApp surfaces unknown apps', async () => {
    const db = makeDb();
    await expect(transitionApp(deps(db), 'nope', 'preview', SERVICE)).rejects.toThrow(
      /lookup failed/,
    );
  });
});
