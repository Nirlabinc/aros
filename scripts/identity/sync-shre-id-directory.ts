import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createSupabaseAdmin } from '../../src/supabase.js';

type ClaimQueueUser = {
  arosUserId: string;
  email: string;
  displayName?: string | null;
  activeMemberships: Array<{
    arosWorkspaceId: string;
    role?: string | null;
  }>;
};

type DirectoryBinding = {
  workspace_id: string;
  application: string;
  external_tenant_id: string;
  created_at: string;
};

type DirectoryWorkspace = {
  id: string;
  name: string;
  kind: string;
};

type DirectoryUser = {
  id: string;
  zitadel_user_id: string;
  workspace_id: string;
  email: string;
};

type TenantName = {
  id: string;
  name: string | null;
  slug: string | null;
};

function arg(name: string): string | undefined {
  const flag = `--${name}`;
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function displayTenantName(tenant: TenantName | undefined, tenantId: string): string {
  const name = tenant?.name?.trim();
  if (name) return `AROS ${name}`;
  const slug = tenant?.slug?.trim();
  if (slug) return `AROS ${slug}`;
  return `AROS ${tenantId.slice(0, 8)}`;
}

async function loadQueue(path: string): Promise<ClaimQueueUser[]> {
  const parsed = JSON.parse(await readFile(path, 'utf8'));
  if (!Array.isArray(parsed.users)) throw new Error('Claim queue must contain a users array');
  return parsed.users.map((user: any, index: number) => {
    if (!user?.arosUserId) throw new Error(`Queue user ${index} missing arosUserId`);
    if (!user?.email) throw new Error(`Queue user ${index} missing email`);
    if (!Array.isArray(user.activeMemberships) || user.activeMemberships.length === 0) {
      throw new Error(`Queue user ${index} missing activeMemberships`);
    }
    return {
      arosUserId: String(user.arosUserId),
      email: normalizeEmail(String(user.email)),
      displayName: typeof user.displayName === 'string' ? user.displayName : null,
      activeMemberships: user.activeMemberships.map((membership: any) => ({
        arosWorkspaceId: String(membership.arosWorkspaceId),
        role: typeof membership.role === 'string' ? membership.role : null,
      })),
    };
  });
}

async function loadTenantNames(tenantIds: string[]): Promise<Map<string, TenantName>> {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return new Map();
  const supabase = createSupabaseAdmin();
  const { data, error } = await supabase.from('tenants').select('id,name,slug').in('id', tenantIds);
  if (error) throw new Error(`Failed to load AROS tenant names: ${error.message}`);
  return new Map((data ?? []).map((tenant: any) => [String(tenant.id), {
    id: String(tenant.id),
    name: typeof tenant.name === 'string' ? tenant.name : null,
    slug: typeof tenant.slug === 'string' ? tenant.slug : null,
  }]));
}

async function directoryRequest<T>(
  baseUrl: string,
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; value: T | null }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const value = text ? JSON.parse(text) as T : null;
  return { status: response.status, value };
}

function appRegistryPayload() {
  return {
    displayName: 'AROS',
    kind: 'first-party',
    status: 'active',
    issuer: 'https://id.shre.ai',
    audiences: ['aros-web', 'app.aros.live'],
    redirectUris: ['https://app.aros.live/auth/oidc/callback'],
    allowedOrigins: ['https://app.aros.live'],
    requiredScopes: ['openid', 'profile', 'email'],
    tokenAuthMethod: 'none',
  };
}

async function main() {
  const input = arg('input');
  const output = arg('output') || 'docs/missions/evidence/aros-mib-experience-routing-live-sync/shre-id-directory-sync.json';
  const directoryUrl = (arg('directory-url') || 'https://dir.shre.ai').replace(/\/$/, '');
  const application = arg('application') || 'aros';
  const apply = hasFlag('apply');
  const token = process.env.SHRE_ID_DIRECTORY_TOKEN;
  if (!input) throw new Error('Missing --input <shre-id-claim-queue.json>');
  if (!token) throw new Error('Missing SHRE_ID_DIRECTORY_TOKEN. Refusing unauthenticated Directory sync.');

  const users = await loadQueue(input);
  const tenantIds = [...new Set(users.flatMap((user) => user.activeMemberships.map((m) => m.arosWorkspaceId)))].sort();
  const tenantNames = await loadTenantNames(tenantIds);
  const report = {
    generatedAt: new Date().toISOString(),
    mode: apply ? 'apply' : 'dry-run',
    directoryUrl,
    application,
    totals: {
      tenants: tenantIds.length,
      users: users.length,
      missingBindings: 0,
      workspacesCreated: 0,
      bindingsUpserted: 0,
      usersProvisioned: 0,
      usersAlreadyProjected: 0,
    },
    applicationRegistry: { action: 'unknown', status: 0 },
    tenants: [] as any[],
    guarantees: [
      'No AROS identity_links are written by this tool.',
      'Shre-ID email verification remains required before identity-link backfill.',
    ],
  };

  const appCheck = await directoryRequest(directoryUrl, token, 'GET', `/v1/applications/${application}`);
  if (appCheck.status === 200) {
    report.applicationRegistry = { action: 'exists', status: appCheck.status };
  } else if (appCheck.status === 404) {
    report.applicationRegistry = { action: apply ? 'upserted' : 'would-upsert', status: appCheck.status };
    if (apply) {
      const upsert = await directoryRequest(directoryUrl, token, 'PUT', `/v1/applications/${application}`, appRegistryPayload());
      if (upsert.status !== 200) throw new Error(`Failed to upsert application registry ${application}: ${upsert.status}`);
    }
  } else {
    throw new Error(`Failed to read application registry ${application}: ${appCheck.status}`);
  }

  for (const tenantId of tenantIds) {
    const bindingPath = `/v1/application-bindings/resolve?application=${encodeURIComponent(application)}&external_tenant_id=${encodeURIComponent(tenantId)}`;
    const binding = await directoryRequest<DirectoryBinding>(directoryUrl, token, 'GET', bindingPath);
    let workspaceId = binding.value?.workspace_id ?? null;
    const tenantEntry = {
      arosTenantId: tenantId,
      workspaceName: displayTenantName(tenantNames.get(tenantId), tenantId),
      bindingAction: 'none',
      workspaceAction: 'none',
      shreWorkspaceId: workspaceId,
      users: [] as any[],
    };

    if (binding.status === 404) {
      report.totals.missingBindings += 1;
      tenantEntry.bindingAction = apply ? 'upserted' : 'would-upsert';
      tenantEntry.workspaceAction = apply ? 'created' : 'would-create';
      if (apply) {
        const created = await directoryRequest<DirectoryWorkspace>(directoryUrl, token, 'POST', '/v1/workspaces', {
          name: tenantEntry.workspaceName,
          kind: 'merchant',
        });
        if (created.status !== 201 || !created.value?.id) {
          throw new Error(`Failed to create Shre-ID workspace for AROS tenant ${tenantId}: ${created.status}`);
        }
        workspaceId = created.value.id;
        tenantEntry.shreWorkspaceId = workspaceId;
        report.totals.workspacesCreated += 1;
        const upsertBinding = await directoryRequest<DirectoryBinding>(
          directoryUrl,
          token,
          'PUT',
          `/v1/workspaces/${encodeURIComponent(workspaceId)}/application-bindings/${encodeURIComponent(application)}`,
          { external_tenant_id: tenantId },
        );
        if (upsertBinding.status !== 200) {
          throw new Error(`Failed to bind AROS tenant ${tenantId} to Shre-ID workspace ${workspaceId}: ${upsertBinding.status}`);
        }
        report.totals.bindingsUpserted += 1;
      }
    } else if (binding.status !== 200) {
      throw new Error(`Failed to resolve binding for AROS tenant ${tenantId}: ${binding.status}`);
    }

    const tenantUsers = users.filter((user) => user.activeMemberships.some((membership) => membership.arosWorkspaceId === tenantId));
    let existingUsers: DirectoryUser[] = [];
    if (workspaceId) {
      const listed = await directoryRequest<DirectoryUser[]>(directoryUrl, token, 'GET', `/v1/workspaces/${encodeURIComponent(workspaceId)}/users`);
      if (listed.status !== 200) throw new Error(`Failed to list Shre-ID users for workspace ${workspaceId}: ${listed.status}`);
      existingUsers = listed.value ?? [];
    }
    const existingEmails = new Set(existingUsers.map((user) => normalizeEmail(user.email)));

    for (const user of tenantUsers) {
      const role = user.activeMemberships.find((membership) => membership.arosWorkspaceId === tenantId)?.role ?? 'member';
      const alreadyProjected = existingEmails.has(user.email);
      const userEntry = {
        arosUserId: user.arosUserId,
        email: user.email,
        role,
        action: alreadyProjected ? 'none-existing-directory-user' : apply && workspaceId ? 'provisioned' : 'would-provision',
      };
      if (alreadyProjected) {
        report.totals.usersAlreadyProjected += 1;
      } else if (apply && workspaceId) {
        const provisioned = await directoryRequest<DirectoryUser>(
          directoryUrl,
          token,
          'POST',
          `/v1/workspaces/${encodeURIComponent(workspaceId)}/users`,
          {
            email: user.email,
            display_name: user.displayName ?? user.email,
            roles: [role],
            send_invite: true,
          },
        );
        if (provisioned.status !== 201) {
          throw new Error(`Failed to provision ${user.email} into ${workspaceId}: ${provisioned.status}`);
        }
        report.totals.usersProvisioned += 1;
      }
      tenantEntry.users.push(userEntry);
    }
    report.tenants.push(tenantEntry);
  }

  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report.totals, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
