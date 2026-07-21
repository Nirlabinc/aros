import { createSupabaseAdmin } from '../../src/supabase.js';

function arg(name: string): string | undefined {
  const flag = `--${name}`;
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

function requireArg(name: string): string {
  const value = arg(name);
  if (!value) throw new Error(`Missing --${name}`);
  return value;
}

async function main() {
  const userId = requireArg('user-id');
  const tenantId = requireArg('tenant-id');
  const expectedEmail = requireArg('expected-email').toLowerCase();
  const preferredExperience = arg('preferred-experience') || 'mib';

  if (preferredExperience !== 'mib' && preferredExperience !== 'aros') {
    throw new Error('--preferred-experience must be mib or aros');
  }

  const supabase = createSupabaseAdmin();
  const { data: user, error: userError } = await supabase.auth.admin.getUserById(userId);
  if (userError) throw userError;
  const email = user.user?.email?.toLowerCase();
  if (email !== expectedEmail) {
    throw new Error(`User email mismatch for ${userId}: expected ${expectedEmail}, got ${email || 'missing'}`);
  }

  const { data: member, error: memberError } = await supabase
    .from('tenant_members')
    .select('tenant_id,user_id,role,status,experience_grants')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle();
  if (memberError) throw memberError;
  if (!member) throw new Error(`No active tenant membership for ${userId} in ${tenantId}`);

  const grants = Array.from(new Set([...(member.experience_grants || ['aros']), 'aros', 'mib']));
  const { error: grantError } = await supabase
    .from('tenant_members')
    .update({ experience_grants: grants })
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .eq('status', 'active');
  if (grantError) throw grantError;

  const { error: entitlementError } = await supabase.from('marketplace_app_entitlements').upsert(
    {
      tenant_id: tenantId,
      app_key: 'mib',
      status: 'active',
      source: 'aros-experience-routing',
      enabled_by: userId,
      enabled_at: new Date().toISOString(),
      disabled_at: null,
      metadata: { activatedBy: 'activate-mib-for-user' },
    },
    { onConflict: 'tenant_id,app_key' },
  );
  if (entitlementError) throw entitlementError;

  const { error: preferenceError } = await supabase.from('user_experience_preferences').upsert(
    {
      user_id: userId,
      tenant_id: tenantId,
      preferred_experience: preferredExperience,
      last_selected_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,tenant_id' },
  );
  if (preferenceError) throw preferenceError;

  const [{ data: updatedMember }, { data: entitlement }, { data: preference }] = await Promise.all([
    supabase
      .from('tenant_members')
      .select('tenant_id,user_id,role,status,experience_grants')
      .eq('tenant_id', tenantId)
      .eq('user_id', userId)
      .eq('status', 'active')
      .single(),
    supabase
      .from('marketplace_app_entitlements')
      .select('tenant_id,app_key,status,source')
      .eq('tenant_id', tenantId)
      .eq('app_key', 'mib')
      .single(),
    supabase
      .from('user_experience_preferences')
      .select('tenant_id,user_id,preferred_experience,last_selected_at')
      .eq('tenant_id', tenantId)
      .eq('user_id', userId)
      .single(),
  ]);

  console.log(JSON.stringify({ user: { id: userId, email }, member: updatedMember, entitlement, preference }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
