import { createSupabaseAdmin } from '../../src/supabase.js';
import { decideExperienceRoute, loadExperiencePolicy, verifyHandoff } from '../../src/auth/experience-routing.js';

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

function redactHandoff(targetUrl: string): { redactedUrl: string; handoff: string | null } {
  const url = new URL(targetUrl);
  const handoff = url.searchParams.get('handoff');
  if (handoff) url.searchParams.set('handoff', '[redacted]');
  return { redactedUrl: url.toString(), handoff };
}

async function main() {
  const userId = requireArg('user-id');
  const workspaceId = requireArg('tenant-id');
  const expectedEmail = requireArg('expected-email').toLowerCase();
  const returnTo = arg('return-to') || '/dashboard';
  const supabase = createSupabaseAdmin();

  const { data: user, error: userError } = await supabase.auth.admin.getUserById(userId);
  if (userError) throw userError;
  const email = user.user?.email?.toLowerCase();
  if (email !== expectedEmail) {
    throw new Error(`User email mismatch for ${userId}: expected ${expectedEmail}, got ${email || 'missing'}`);
  }

  const { data: identity } = await supabase
    .from('identity_links')
    .select('provider,provider_subject')
    .eq('provider', 'shre-id')
    .eq('user_id', userId)
    .maybeSingle();

  const policy = await loadExperiencePolicy(supabase, {
    userId,
    workspaceId,
    email,
    subject: identity?.provider_subject,
    role: 'owner',
    returnTo,
  });
  const decision = decideExperienceRoute(
    { userId, workspaceId, email, subject: identity?.provider_subject, role: 'owner', returnTo },
    policy,
  );
  const { redactedUrl, handoff } = redactHandoff(decision.targetUrl);
  const decoded = handoff && process.env.AROS_MIB_HANDOFF_SECRET ? verifyHandoff(process.env.AROS_MIB_HANDOFF_SECRET, handoff) : null;
  const target = new URL(decision.targetUrl);
  const checks = {
    policyPrefersMib: policy.preferredExperience === 'mib',
    policyGrantsMib: policy.experienceGrants?.includes('mib') === true,
    policyEnablesMib: policy.mibEnabled === true,
    routesToMib: decision.experience === 'mib',
    usesMibOrigin: target.origin === 'https://mib.aros.live',
    usesShreStartPath: target.pathname === '/api/auth/shre/start',
    hasHandoff: Boolean(handoff),
    handoffWorkspaceMatches: decoded?.workspaceId === workspaceId,
    handoffEmailMatches: decoded?.email === email,
  };

  console.log(JSON.stringify({ user: { id: userId, email }, workspaceId, policy, decision: { ...decision, targetUrl: redactedUrl }, checks }, null, 2));
  const failed = Object.entries(checks).filter(([, ok]) => !ok);
  if (failed.length) {
    throw new Error(`Failed checks: ${failed.map(([name]) => name).join(', ')}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
