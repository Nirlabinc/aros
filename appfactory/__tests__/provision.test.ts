import { describe, expect, it } from 'vitest';
import {
  addBuildCredits,
  appRoleName,
  appSchemaName,
  containerName,
  generateRolePassword,
  provisionApp,
  renderProvisionSql,
} from '../provision.js';
import { makeDb, makeRegistry, makeSql } from './helpers.js';

describe('naming helpers', () => {
  it('derives app_<8hex> schema from the app uuid', () => {
    expect(appSchemaName('01234567-89ab-cdef-0123-456789abcdef')).toBe('app_01234567');
  });

  it('rejects non-uuid input', () => {
    expect(() => appSchemaName('not-a-uuid')).toThrow(/not a uuid/);
  });

  it('role name is <schema>_svc and validates the schema', () => {
    expect(appRoleName('app_01234567')).toBe('app_01234567_svc');
    expect(() => appRoleName('public')).toThrow(/invalid app schema/);
  });

  it('container names follow the wildcard-ingress contract', () => {
    expect(containerName('shift-planner')).toBe('app-shift-planner');
    expect(containerName('shift-planner', true)).toBe('app-shift-planner-beta');
    expect(() => containerName('-bad-')).toThrow(/invalid subdomain/);
  });
});

describe('renderProvisionSql', () => {
  const schema = 'app_01234567';
  const role = 'app_01234567_svc';

  it('creates schema + scoped LOGIN role, walls off public', () => {
    const sql = renderProvisionSql(schema, role, 'pw123');
    expect(sql).toContain(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    expect(sql).toContain(`CREATE ROLE ${role} LOGIN NOINHERIT PASSWORD 'pw123'`);
    expect(sql).toContain(`GRANT USAGE ON SCHEMA ${schema} TO ${role}`);
    expect(sql).toContain(`REVOKE ALL ON SCHEMA public FROM ${role}`);
    expect(sql).toContain(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${role}`);
    expect(sql).toContain(`ALTER ROLE ${role} SET search_path = ${schema}`);
    // no USAGE on public is ever granted
    expect(sql).not.toMatch(/GRANT USAGE ON SCHEMA public/);
  });

  it('escapes single quotes in the password literal', () => {
    const sql = renderProvisionSql(schema, role, "p'w");
    expect(sql).toContain("PASSWORD 'p''w'");
  });

  it('rejects mismatched or invalid identifiers (no injection surface)', () => {
    expect(() => renderProvisionSql('public; DROP TABLE tenants', role, 'x')).toThrow(
      /invalid app schema/,
    );
    expect(() => renderProvisionSql(schema, 'postgres', 'x')).toThrow(/role must be/);
  });
});

describe('provisionApp', () => {
  const input = {
    tenantId: 'tenant-1',
    slug: 'shift-planner',
    displayName: 'Shift Planner',
    createdBy: 'user-1',
  };

  it('inserts a draft row, runs the DDL, and writes the created event', async () => {
    const db = makeDb();
    const sql = makeSql();
    const result = await provisionApp({ registry: makeRegistry(db), sql }, input);

    // registry row
    expect(db.tables.tenant_apps).toHaveLength(1);
    const row = db.tables.tenant_apps[0]!;
    expect(row.status).toBe('draft');
    expect(row.subdomain).toBe('shift-planner'); // defaults to slug
    expect(row.db_schema).toMatch(/^app_[0-9a-f]{8}$/);
    expect(row.hosting_fee_cents).toBe(0); // previews free; priced at go-live
    expect(row.build_credits_used).toBe(0);

    // DDL executed once, matching the returned template
    expect(sql.executed).toHaveLength(1);
    expect(sql.executed[0]).toBe(result.sql);
    expect(result.sql).toContain(`CREATE SCHEMA IF NOT EXISTS ${result.schema}`);
    expect(result.role).toBe(`${result.schema}_svc`);
    expect(result.rolePassword.length).toBeGreaterThanOrEqual(24);

    // audit trail
    expect(db.tables.app_events).toHaveLength(1);
    const evt = db.tables.app_events[0]!;
    expect(evt.event).toBe('created');
    expect(evt.actor).toBe('user-1');
    expect(evt.actor_type).toBe('user');
    expect(evt.to_status).toBe('draft');
  });

  it('rolls back the registry row when the DDL fails', async () => {
    const db = makeDb();
    await expect(
      provisionApp({ registry: makeRegistry(db), sql: makeSql({ fail: true }) }, input),
    ).rejects.toThrow(/schema provisioning failed .* rolled back/);
    expect(db.tables.tenant_apps).toHaveLength(0);
    expect(db.tables.app_events).toHaveLength(0);
    // sequencing: insert happened before delete
    expect(db.ops).toEqual(['insert:tenant_apps', 'delete:tenant_apps']);
  });

  it('rejects invalid slugs and subdomains before any DB work', async () => {
    const db = makeDb();
    const deps = { registry: makeRegistry(db), sql: makeSql() };
    await expect(provisionApp(deps, { ...input, slug: 'X!' })).rejects.toThrow(/invalid app slug/);
    await expect(provisionApp(deps, { ...input, subdomain: '-nope' })).rejects.toThrow(
      /invalid subdomain/,
    );
    expect(db.ops).toHaveLength(0);
  });

  it('generates unique, url-safe role passwords', () => {
    const a = generateRolePassword();
    const b = generateRolePassword();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('addBuildCredits (metered LLM build spend)', () => {
  it('accumulates credits on the registry row', async () => {
    const db = makeDb();
    db.tables.tenant_apps.push({ id: 'app-1', build_credits_used: 10 });
    const deps = { registry: makeRegistry(db), sql: makeSql() };
    const total = await addBuildCredits(deps, 'app-1', 15);
    expect(total).toBe(25);
    expect(db.tables.tenant_apps[0]!.build_credits_used).toBe(25);
  });

  it('rejects non-positive amounts', async () => {
    const deps = { registry: makeRegistry(makeDb()), sql: makeSql() };
    await expect(addBuildCredits(deps, 'app-1', 0)).rejects.toThrow(/positive/);
    await expect(addBuildCredits(deps, 'app-1', -5)).rejects.toThrow(/positive/);
  });
});
