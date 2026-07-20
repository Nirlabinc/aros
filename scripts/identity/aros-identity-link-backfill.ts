import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createSupabaseAdmin } from '../../src/supabase.js';

type Mapping = {
  userId: string;
  providerSubject: string;
  email?: string | null;
};

function arg(name: string): string | undefined {
  const flag = `--${name}`;
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function readMappings(path: string): Promise<Mapping[]> {
  const raw = await readFile(path, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('Mapping file must be a JSON array');
  return parsed.map((row, index) => {
    if (!row || typeof row !== 'object') throw new Error(`Mapping ${index} is not an object`);
    if (typeof row.userId !== 'string' || !row.userId) throw new Error(`Mapping ${index} missing userId`);
    if (typeof row.providerSubject !== 'string' || !row.providerSubject) {
      throw new Error(`Mapping ${index} missing providerSubject`);
    }
    return {
      userId: row.userId,
      providerSubject: row.providerSubject,
      email: typeof row.email === 'string' ? row.email.toLowerCase() : null,
    };
  });
}

async function main() {
  const mappingPath = arg('mapping');
  const output = arg('output') || 'docs/missions/evidence/aros-mib-experience-routing-live-sync/identity-link-backfill.json';
  const provider = arg('provider') || 'shre-id';
  const apply = hasFlag('apply');
  if (!mappingPath) throw new Error('Missing --mapping <file>. Refusing to infer shre-id subjects.');
  if (provider !== 'shre-id') throw new Error('Only provider=shre-id is supported for this backfill');

  const mappings = await readMappings(mappingPath);
  const supabase = createSupabaseAdmin();
  const userIds = [...new Set(mappings.map((row) => row.userId))];
  const { data: members, error: memberError } = await supabase
    .from('tenant_members')
    .select('tenant_id,user_id,status')
    .in('user_id', userIds);
  if (memberError) throw new Error(`Failed to validate memberships: ${memberError.message}`);

  const activeMemberIds = new Set((members ?? []).filter((row: any) => row.status === 'active').map((row: any) => row.user_id));
  const report = {
    generatedAt: new Date().toISOString(),
    mode: apply ? 'apply' : 'dry-run',
    provider,
    totals: {
      mappings: mappings.length,
      activeMembershipUsers: activeMemberIds.size,
      rejectedNoActiveMembership: 0,
      wouldUpsert: 0,
      upserted: 0,
    },
    rows: [] as any[],
  };

  for (const mapping of mappings) {
    const active = activeMemberIds.has(mapping.userId);
    const row = {
      userId: mapping.userId,
      provider,
      providerSubject: mapping.providerSubject,
      email: mapping.email,
      activeMembership: active,
      action: active ? (apply ? 'upserted' : 'would-upsert') : 'rejected-no-active-membership',
    };
    if (!active) {
      report.totals.rejectedNoActiveMembership += 1;
      report.rows.push(row);
      continue;
    }
    report.totals.wouldUpsert += 1;
    if (apply) {
      const { error } = await supabase.from('identity_links').upsert({
        provider,
        provider_subject: mapping.providerSubject,
        user_id: mapping.userId,
        email: mapping.email,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'provider,provider_subject' });
      if (error) throw new Error(`Failed to upsert ${mapping.userId}: ${error.message}`);
      report.totals.upserted += 1;
    }
    report.rows.push(row);
  }

  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report.totals, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
