#!/usr/bin/env node
/**
 * Data-freshness sentinel — catches silent sync blindness.
 *
 * Two incidents motivated this (2026-07-20): (1) an RLS-possessed admin
 * client left the snapshotter seeing zero connected connectors for 3 days
 * (`captured=0`, no errors anywhere); (2) bare-date invoice queries returned
 * "No Data available" for weeks while dashboards showed a confident $0.
 * Both were invisible because nothing FAILED — data just stopped arriving.
 *
 * Checks, per tenant with a connected connector:
 *   - a store snapshot exists and is younger than STALE_HOURS (default 13 =
 *     2× the 6h snapshot cadence + 1h grace)
 *   - the newest snapshot is not `partial` (partial = sales numbers
 *     unreliable)
 *
 * Exits 1 with FAIL lines on stdout when anything is stale — wire it into
 * cron alongside journey-walk so failures land in the same alert log.
 *
 * Usage: node scripts/data-freshness-check.mjs   (needs SUPABASE_URL +
 * SUPABASE_SERVICE_ROLE_KEY in the environment)
 */

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STALE_HOURS = Number(process.env.FRESHNESS_STALE_HOURS || 13);

if (!url || !key) {
  console.error('FAIL · data-freshness · SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set');
  process.exit(1);
}

async function rest(path) {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.json();
}

const failures = [];
try {
  const connectors = await rest('tenant_connectors?status=eq.connected&select=id,tenant_id,name,type');
  if (connectors.length === 0) {
    console.log('OK · data-freshness · no connected connectors to check');
    process.exit(0);
  }

  const tenants = new Map();
  for (const c of connectors) {
    if (!tenants.has(c.tenant_id)) tenants.set(c.tenant_id, []);
    tenants.get(c.tenant_id).push(c);
  }

  const staleBefore = Date.now() - STALE_HOURS * 3600_000;
  for (const [tenantId, rows] of tenants) {
    const snaps = await rest(`store_snapshots?tenant_id=eq.${tenantId}&select=captured_at,partial&order=captured_at.desc&limit=1`);
    const names = rows.map((r) => r.name).join(', ');
    const newest = snaps[0];
    if (!newest) {
      failures.push(`FAIL · data-freshness · tenant ${tenantId} (${names}): connected but has NO snapshots at all`);
      continue;
    }
    const age = Date.now() - Date.parse(newest.captured_at);
    if (age > STALE_HOURS * 3600_000 || Date.parse(newest.captured_at) < staleBefore) {
      failures.push(`FAIL · data-freshness · tenant ${tenantId} (${names}): newest snapshot is ${(age / 3600_000).toFixed(1)}h old (limit ${STALE_HOURS}h) — snapshotter may be blind`);
      continue;
    }
    if (newest.partial) {
      failures.push(`FAIL · data-freshness · tenant ${tenantId} (${names}): newest snapshot is partial — sales numbers unreliable`);
      continue;
    }
    console.log(`OK · data-freshness · tenant ${tenantId} (${names}): snapshot ${(age / 3600_000).toFixed(1)}h old, complete`);
  }
} catch (err) {
  failures.push(`FAIL · data-freshness · check errored: ${err instanceof Error ? err.message : String(err)}`);
}

if (failures.length) {
  for (const f of failures) console.log(f);
  process.exit(1);
}
