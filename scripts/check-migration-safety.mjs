#!/usr/bin/env node
// Migration safety lint — makes the two authority-boundary bug classes that a
// multi-agent review caught (a definer-rights view auto-granted to anon = a
// cross-tenant catalog leak; and un-RLS'd tenant tables) UN-MERGEABLE instead
// of relying on a sharp reviewer. Scans supabase/migrations/*.sql for:
//   1. A CREATE TABLE public.<t> that has no ENABLE ROW LEVEL SECURITY anywhere
//      in the migration set (unless allow-listed).
//   2. A view declared SECURITY DEFINER, or a CREATE VIEW public.* that neither
//      sets security_invoker=true nor REVOKEs from anon/authenticated.
// Exit non-zero on any violation. Run in CI on any PR touching migrations.
//
// Allow-list: prefix a table/view name in ALLOWLIST for intentional exceptions
// (e.g. reference data with no tenant column) — an explicit, reviewed opt-out.

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIG_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'migrations');
const ALLOWLIST = new Set([
  // tables that legitimately have no tenant scoping (global/reference); add with a reason.
]);

const files = readdirSync(MIG_DIR).filter((f) => f.endsWith('.sql'));
const all = files.map((f) => readFileSync(join(MIG_DIR, f), 'utf8')).join('\n');
const norm = all.toLowerCase();

const violations = [];

// (1) RLS coverage: every CREATE TABLE public.<t> needs an ENABLE ROW LEVEL SECURITY on it.
const tableRe = /create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-z0-9_]+)/g;
for (const m of norm.matchAll(tableRe)) {
  const t = m[1];
  if (ALLOWLIST.has(t)) continue;
  const hasRls = new RegExp(`alter\\s+table\\s+public\\.${t}\\s+enable\\s+row\\s+level\\s+security`).test(norm)
    // DO-block loops that enable RLS over an array including the table also count:
    || new RegExp(`enable\\s+row\\s+level\\s+security[\\s\\S]{0,4000}${t}`).test(norm)
    || new RegExp(`${t}[\\s\\S]{0,4000}enable\\s+row\\s+level\\s+security`).test(norm);
  if (!hasRls) violations.push(`Table public.${t} has no ENABLE ROW LEVEL SECURITY (add RLS or allow-list with a reason).`);
}

// (2) SECURITY DEFINER views, or public views without security_invoker + a REVOKE.
if (/security\s+definer/.test(norm)) {
  // find the view/function names near the definer clause for a helpful message
  for (const m of all.matchAll(/create\s+(?:or\s+replace\s+)?view\s+([a-z0-9_.]+)[\s\S]{0,200}?security\s+definer/gi)) {
    violations.push(`View ${m[1]} is SECURITY DEFINER — a definer view bypasses RLS and is auto-granted to anon. Use security_invoker=true + REVOKE, or get explicit sign-off.`);
  }
}
const viewRe = /create\s+or\s+replace\s+view\s+public\.([a-z0-9_]+)/g;
for (const m of norm.matchAll(viewRe)) {
  const v = m[1];
  if (ALLOWLIST.has(v)) continue;
  const block = norm.slice(m.index, m.index + 600);
  const hasInvoker = /security_invoker\s*=\s*true/.test(block);
  const hasRevoke = new RegExp(`revoke\\s+all\\s+on\\s+public\\.${v}\\s+from\\s+anon`).test(norm)
    || new RegExp(`revoke[\\s\\S]{0,200}${v}[\\s\\S]{0,200}anon`).test(norm);
  if (!hasInvoker && !hasRevoke) {
    violations.push(`View public.${v} is neither security_invoker=true nor REVOKE'd from anon/authenticated — Supabase auto-grants SELECT to the anon key (cross-tenant read risk).`);
  }
}

if (violations.length) {
  console.error('✗ Migration safety check FAILED:\n' + violations.map((v) => '  - ' + v).join('\n'));
  console.error('\nThese are the authority-boundary classes a code review caught on PRs #94/#108. Fix them at the DB layer, not in app code.');
  process.exit(1);
}
console.log(`✓ Migration safety check passed (${files.length} migrations scanned).`);
