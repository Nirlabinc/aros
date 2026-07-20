import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createSupabaseAdmin } from '../../src/supabase.js';

type AuthUser = { id: string; email?: string; user_metadata?: Record<string, unknown>; created_at?: string };

function arg(name: string): string | undefined {
  const flag = `--${name}`;
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

async function listAuthUsers(): Promise<AuthUser[]> {
  const supabase = createSupabaseAdmin();
  const users: AuthUser[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`Failed to list auth users: ${error.message}`);
    const batch = (data?.users ?? []) as AuthUser[];
    users.push(...batch);
    if (batch.length < 1000) break;
  }
  return users;
}

async function main() {
  const output = arg('output') || 'docs/missions/evidence/aros-mib-experience-routing-live-sync/user-sync-dry-run.json';
  const supabase = createSupabaseAdmin();
  const users = await listAuthUsers();
  let memberSchema = 'post-migration';
  let { data: members, error: memberError } = await supabase
    .from('tenant_members')
    .select('tenant_id,user_id,role,status,is_default,experience_grants');
  if (memberError && String(memberError.message || '').includes('experience_grants')) {
    memberSchema = 'pre-migration';
    const fallback = await supabase.from('tenant_members').select('tenant_id,user_id,role,status,is_default');
    members = fallback.data;
    memberError = fallback.error;
  }

  const { data: links, error: linkError } = await supabase.from('identity_links').select('provider,provider_subject,user_id,email');
  if (memberError) throw new Error(`Failed to list tenant members: ${memberError.message}`);
  if (linkError && !String(linkError.message || '').includes('identity_links')) throw new Error(`Failed to list identity links: ${linkError.message}`);

  const memberRows = members ?? [];
  const linkRows = links ?? [];
  const linkedUserIds = new Set(linkRows.map((row: any) => row.user_id));
  const activeMemberUserIds = new Set(memberRows.filter((row: any) => row.status === 'active').map((row: any) => row.user_id));
  const report = {
    generatedAt: new Date().toISOString(),
    mode: 'dry-run',
    schema: {
      tenantMembers: memberSchema,
      identityLinks: linkError ? 'missing' : 'present',
    },
    totals: {
      authUsers: users.length,
      activeMembershipUsers: activeMemberUserIds.size,
      identityLinks: linkRows.length,
      unlinkedActiveUsers: [...activeMemberUserIds].filter((id) => !linkedUserIds.has(id)).length,
    },
    users: users.map((user) => {
      const memberships = memberRows.filter((row: any) => row.user_id === user.id);
      const identityLinks = linkRows.filter((row: any) => row.user_id === user.id);
      return {
        id: user.id,
        email: user.email ?? null,
        name: user.user_metadata?.name ?? user.user_metadata?.full_name ?? null,
        membershipCount: memberships.length,
        memberships,
        identityLinks,
        syncAction: identityLinks.length ? 'none-existing-link' : memberships.length ? 'needs-shre-id-link' : 'no-active-workspace',
      };
    }),
  };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report.totals, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
