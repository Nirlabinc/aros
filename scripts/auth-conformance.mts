import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { findHardcodedSecrets, inspectAuthSurface, type AuthSurfaceKind } from '../security/auth-conformance.js';

const root = resolve(process.cwd());
const surfaces: Array<{ file: string; kind: AuthSurfaceKind }> = [{ file: 'src/server.ts', kind: 'resource-server' }];
const ignored = new Set(['node_modules', '.git', '.claude', 'dist', 'coverage', 'data', '__tests__']);
// This file intentionally contains a CI-only signing fixture; production code
// imports only its public key. Keep exemptions exact and reviewable.
const secretFixtureAllowlist = new Set(['src/licensing/keys.ts']);
const codeExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.mts', '.json', '.yml', '.yaml']);
const files: string[] = [];
function walk(directory: string) { for (const entry of readdirSync(directory)) { if (ignored.has(entry)) continue; const path = join(directory, entry); const stat = statSync(path); if (stat.isDirectory()) walk(path); else if (codeExtensions.has(extname(path))) files.push(path); } }
walk(root);

let failed = false;
for (const surface of surfaces) {
  const path = resolve(root, surface.file); const findings = inspectAuthSurface(readFileSync(path, 'utf8'), surface.kind);
  for (const finding of findings) { failed = true; console.error(`[auth-conformance] ${surface.file}: ${finding.rule}: ${finding.message}`); }
}
for (const file of files) {
  if (secretFixtureAllowlist.has(relative(root, file).replaceAll('\\', '/'))) continue;
  const findings = findHardcodedSecrets(readFileSync(file, 'utf8'));
  for (const finding of findings) { failed = true; console.error(`[auth-conformance] ${relative(root, file)}: ${finding.rule}: ${finding.message}`); }
}
if (failed) process.exitCode = 1;
else console.log(`[auth-conformance] passed (${surfaces.length} auth surface, ${files.length} files scanned for secrets)`);
