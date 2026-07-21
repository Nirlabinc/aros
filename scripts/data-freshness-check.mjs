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
  await emailOwners(failures).catch((e) => console.log(`WARN · data-freshness · email step failed: ${e.message}`));
  process.exit(1);
}

/**
 * Email workspace members who enabled connector-health notifications.
 * 20h cooldown per tenant (state file) so a persistent failure emails at
 * most daily, not every 6h cron tick. Best-effort: email problems never
 * change the exit code — the log line above is the primary alert.
 */
async function emailOwners(failLines) {
  const sgKey = process.env.SENDGRID_API_KEY;
  if (!sgKey) return;
  const { readFileSync, writeFileSync, mkdirSync } = await import('node:fs');
  const stateFile = '/opt/shre-ops/state/data-freshness-mail.json';
  let sent = {};
  try { sent = JSON.parse(readFileSync(stateFile, 'utf8')); } catch { /* first run */ }

  const byTenant = new Map();
  for (const line of failLines) {
    const m = line.match(/tenant ([0-9a-f-]{36})/);
    if (m) byTenant.set(m[1], [...(byTenant.get(m[1]) || []), line]);
  }

  for (const [tenantId, lines] of byTenant) {
    if (sent[tenantId] && Date.now() - sent[tenantId] < 20 * 3600_000) continue;
    const [members, prefs] = await Promise.all([
      rest(`tenant_members?tenant_id=eq.${tenantId}&status=eq.active&select=user_id`),
      rest(`notification_preferences?tenant_id=eq.${tenantId}&select=user_id,event_type,channel,enabled,destination`),
    ]);
    for (const member of members) {
      const mine = prefs.filter((p) => p.user_id === member.user_id);
      const row = mine.find((p) => p.event_type === 'connector-health' && p.channel === 'email');
      if (row ? !row.enabled : false) continue; // default for connector-health email is ON
      let to = mine.find((p) => p.channel === 'email' && p.destination)?.destination || '';
      if (!to) {
        const userRes = await fetch(`${url}/auth/v1/admin/users/${member.user_id}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
        if (userRes.ok) to = (await userRes.json()).email || '';
      }
      if (!to) continue;
      await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: { authorization: `Bearer ${sgKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: to }] }],
          from: { email: process.env.EMAIL_FROM || 'no-reply@aros.live', name: 'AROS' },
          subject: 'AROS: a store connection needs attention',
          content: [{ type: 'text/plain', value: `Your store data has stopped syncing:\n\n${lines.join('\n')}\n\nCheck Stores → Connection Health at https://app.aros.live/connection-health\nManage notifications: https://app.aros.live/notifications` }],
        }),
      }).catch(() => {});
    }
    sent[tenantId] = Date.now();
  }
  mkdirSync('/opt/shre-ops/state', { recursive: true });
  writeFileSync(stateFile, JSON.stringify(sent));
}
