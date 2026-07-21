import { createHmac, timingSafeEqual } from 'node:crypto';

export type Experience = 'aros' | 'mib';

export type ExperienceRouteDecision = {
  workspaceId: string;
  experience: Experience;
  targetUrl: string;
  reason: string;
};

export type ExperienceRouteInput = {
  userId: string;
  subject?: string;
  email?: string;
  workspaceId: string;
  role: string;
  returnTo?: string;
  sourceIntent?: 'operator' | 'standard-desktop' | 'developer-desktop' | 'internal-builder';
};

export type ExperiencePolicy = {
  defaultExperience?: Experience | null;
  preferredExperience?: Experience | null;
  experienceGrants?: string[] | null;
  mibEnabled?: boolean;
};

export type ExperienceRouteConfig = {
  appOrigin?: string;
  mibOrigin?: string;
  mibStartPath?: string;
};

function safePath(value: string | undefined, fallback = '/dashboard'): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return fallback;
  return value;
}

function origin(value: string | undefined, fallback: string): string {
  try {
    const url = new URL(value || fallback);
    return url.origin;
  } catch {
    return fallback;
  }
}

function intentDefault(input?: ExperienceRouteInput['sourceIntent']): Experience | null {
  if (input === 'developer-desktop' || input === 'internal-builder') return 'mib';
  if (input === 'operator' || input === 'standard-desktop') return 'aros';
  return null;
}

function signHandoff(secret: string, payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyHandoff(secret: string, token: string, now = Date.now()): Record<string, unknown> | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', secret).update(body).digest();
  const actual = Buffer.from(sig, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Record<string, unknown>;
  if (typeof payload.exp !== 'number' || payload.exp < now) return null;
  return payload;
}

export function decideExperienceRoute(
  input: ExperienceRouteInput,
  policy: ExperiencePolicy,
  config: ExperienceRouteConfig = {},
): ExperienceRouteDecision {
  const grants = new Set(policy.experienceGrants?.length ? policy.experienceGrants : ['aros']);
  const mayUseMib = Boolean(policy.mibEnabled && grants.has('mib'));
  let experience: Experience = 'aros';
  let reason = 'fallback';

  if (policy.preferredExperience === 'mib' && mayUseMib) {
    experience = 'mib';
    reason = 'user-preference';
  } else if (policy.preferredExperience === 'aros') {
    experience = 'aros';
    reason = 'user-preference';
  } else if (policy.defaultExperience === 'mib' && mayUseMib) {
    experience = 'mib';
    reason = 'workspace-default';
  } else if (policy.defaultExperience === 'aros') {
    experience = 'aros';
    reason = 'workspace-default';
  } else {
    const byIntent = intentDefault(input.sourceIntent);
    if (byIntent === 'mib' && mayUseMib) {
      experience = 'mib';
      reason = 'source-intent';
    } else if (byIntent === 'aros') {
      experience = 'aros';
      reason = 'source-intent';
    }
  }

  const path = safePath(input.returnTo);
  const appOrigin = origin(config.appOrigin || process.env.AROS_APP_ORIGIN, 'https://app.aros.live');
  const mibOrigin = origin(config.mibOrigin || process.env.AROS_MIB_ORIGIN, 'https://mib.aros.live');
  if (experience === 'mib') {
    const startPath = config.mibStartPath || process.env.AROS_MIB_OIDC_START_PATH || '/api/auth/shre/start';
    const url = new URL(startPath, mibOrigin);
    url.searchParams.set('returnTo', path);
    url.searchParams.set('workspaceId', input.workspaceId);
    const handoffSecret = process.env.AROS_MIB_HANDOFF_SECRET;
    if (handoffSecret) {
      url.searchParams.set('handoff', signHandoff(handoffSecret, {
        sub: input.subject,
        email: input.email,
        userId: input.userId,
        workspaceId: input.workspaceId,
        exp: Date.now() + 600_000,
      }));
    }
    return { workspaceId: input.workspaceId, experience, targetUrl: url.toString(), reason };
  }
  return { workspaceId: input.workspaceId, experience, targetUrl: new URL(path, appOrigin).toString(), reason };
}

export async function loadExperiencePolicy(supabase: { from(table: string): any }, input: ExperienceRouteInput): Promise<ExperiencePolicy> {
  const [{ data: setting }, { data: preference }, { data: membership }, { data: entitlement }] = await Promise.all([
    supabase.from('workspace_experience_settings').select('default_experience').eq('tenant_id', input.workspaceId).maybeSingle(),
    supabase.from('user_experience_preferences').select('preferred_experience').eq('tenant_id', input.workspaceId).eq('user_id', input.userId).maybeSingle(),
    supabase.from('tenant_members').select('experience_grants').eq('tenant_id', input.workspaceId).eq('user_id', input.userId).eq('status', 'active').maybeSingle(),
    supabase.from('marketplace_app_entitlements').select('app_key,status').eq('tenant_id', input.workspaceId).eq('app_key', 'mib').maybeSingle(),
  ]);
  return {
    defaultExperience: setting?.default_experience ?? null,
    preferredExperience: preference?.preferred_experience ?? null,
    experienceGrants: membership?.experience_grants ?? ['aros'],
    mibEnabled: Boolean(entitlement?.status === 'active' || membership?.experience_grants?.includes?.('mib')),
  };
}
