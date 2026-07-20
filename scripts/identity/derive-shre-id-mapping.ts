import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

function arg(name: string): string | undefined {
  const flag = `--${name}`;
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

const input = arg('input');
const output = arg('output') || 'docs/missions/evidence/aros-mib-experience-routing-live-sync/identity-link-mapping.candidate.json';
const summaryOutput = arg('summary') || 'docs/missions/evidence/aros-mib-experience-routing-live-sync/identity-link-mapping-summary.json';
const sshTarget = arg('ssh') || 'aros-vps';

if (!input) throw new Error('Missing --input <user-sync-dry-run.json>');

const inventory = JSON.parse(await readFile(input, 'utf8'));
const users = (inventory.users ?? [])
  .filter((user: any) => user.syncAction === 'needs-shre-id-link' && user.email && user.membershipCount > 0)
  .map((user: any) => ({
    userId: String(user.id),
    email: String(user.email).trim().toLowerCase(),
  }));

const emails = [...new Set(users.map((user) => user.email))];
const sql = `
select user_id, lower(email) as email
from projections.users14_humans
where is_email_verified is true
  and lower(email) = any(array[${emails.map(quoteLiteral).join(',')}]);
`;

const result = spawnSync(
  'ssh',
  [
    sshTarget,
    'docker exec -i shre-id-idp-postgres-1 psql -h 127.0.0.1 -U zitadel -d zitadel -t -A -F "\t"',
  ],
  { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
);

if (result.status !== 0) {
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}

const byEmail = new Map<string, string[]>();
for (const line of result.stdout.split(/\r?\n/).filter(Boolean)) {
  const [subject, email] = line.split('\t');
  if (!subject || !email) continue;
  const list = byEmail.get(email) ?? [];
  list.push(subject);
  byEmail.set(email, list);
}

const mappings = [];
const rejected = [];
for (const user of users) {
  const subjects = byEmail.get(user.email) ?? [];
  if (subjects.length === 1) {
    mappings.push({ userId: user.userId, providerSubject: subjects[0], email: user.email });
  } else {
    rejected.push({
      userId: user.userId,
      email: user.email,
      reason: subjects.length === 0 ? 'no-verified-shre-id-email-match' : 'multiple-shre-id-email-matches',
      matchCount: subjects.length,
    });
  }
}

const summary = {
  generatedAt: new Date().toISOString(),
  mode: 'read-only',
  inputUsers: users.length,
  uniqueEmails: emails.length,
  matchedMappings: mappings.length,
  rejected: rejected.length,
  output,
};

await mkdir(dirname(output), { recursive: true });
await mkdir(dirname(summaryOutput), { recursive: true });
await writeFile(output, `${JSON.stringify(mappings, null, 2)}\n`);
await writeFile(summaryOutput, `${JSON.stringify({ ...summary, rejected }, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
