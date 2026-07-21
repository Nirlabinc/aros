import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

type InventoryUser = {
  id: string;
  email?: string | null;
  name?: unknown;
  membershipCount?: number;
  memberships?: Array<Record<string, unknown>>;
  identityLinks?: Array<Record<string, unknown>>;
  syncAction?: string;
};

function arg(name: string): string | undefined {
  const flag = `--${name}`;
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeEmail(value: unknown): string | null {
  const email = asString(value)?.toLowerCase() ?? null;
  return email && email.includes('@') ? email : null;
}

function activeMemberships(user: InventoryUser) {
  return (user.memberships ?? [])
    .filter((membership) => membership.status === 'active')
    .map((membership) => ({
      arosWorkspaceId: asString(membership.tenant_id),
      role: asString(membership.role),
      isDefault: membership.is_default === true,
      experienceGrants: Array.isArray(membership.experience_grants)
        ? membership.experience_grants.filter((grant): grant is string => typeof grant === 'string')
        : [],
    }))
    .filter((membership) => membership.arosWorkspaceId);
}

async function main() {
  const input = arg('input');
  const output = arg('output') || 'docs/missions/evidence/aros-mib-experience-routing-live-sync/shre-id-claim-queue.json';
  if (!input) throw new Error('Missing --input <user-sync-dry-run.json>');

  const inventory = JSON.parse(await readFile(input, 'utf8'));
  const users = Array.isArray(inventory.users) ? (inventory.users as InventoryUser[]) : [];
  const queued = users
    .filter((user) => user.syncAction === 'needs-shre-id-link')
    .map((user) => ({
      arosUserId: user.id,
      email: normalizeEmail(user.email),
      displayName: asString(user.name),
      activeMemberships: activeMemberships(user),
      identityLinkPolicy: {
        provider: 'shre-id',
        status: 'claim-required',
        backfillRequirement: 'exact-verified-shre-id-provider-subject',
      },
      nextAction: 'provision-or-claim-user-in-shre-id-then-rerun-derive-shre-id-mapping',
    }))
    .filter((user) => user.email && user.activeMemberships.length > 0)
    .sort((a, b) => a.email!.localeCompare(b.email!));

  const report = {
    generatedAt: new Date().toISOString(),
    mode: 'claim-queue',
    source: input,
    totals: {
      inputUsers: users.length,
      queuedUsers: queued.length,
      skippedUsers: users.length - queued.length,
    },
    guarantees: [
      'No providerSubject values are generated or inferred.',
      'AROS identity_links must only be backfilled after Shre-ID returns an exact verified provider subject.',
    ],
    users: queued,
  };

  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report.totals, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
