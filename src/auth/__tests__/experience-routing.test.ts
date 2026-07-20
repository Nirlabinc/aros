import { describe, expect, it } from 'vitest';
import { decideExperienceRoute } from '../experience-routing';

const base = { userId: 'u1', workspaceId: '11111111-1111-4111-8111-111111111111', role: 'owner' };

describe('experience routing', () => {
  it('defaults operators to AROS', () => {
    const decision = decideExperienceRoute(base, { experienceGrants: ['aros'] });
    expect(decision.experience).toBe('aros');
    expect(decision.targetUrl).toBe('https://app.aros.live/dashboard');
  });

  it('routes MIB-enabled users to the MIB OIDC start path', () => {
    const decision = decideExperienceRoute(
      { ...base, returnTo: '/dashboard' },
      { preferredExperience: 'mib', experienceGrants: ['aros', 'mib'], mibEnabled: true },
    );
    expect(decision.experience).toBe('mib');
    const url = new URL(decision.targetUrl);
    expect(url.origin).toBe('https://mib.aros.live');
    expect(url.pathname).toBe('/api/auth/shre/start');
    expect(url.searchParams.get('workspaceId')).toBe(base.workspaceId);
  });

  it('denies MIB preference without a MIB grant', () => {
    const decision = decideExperienceRoute(base, { preferredExperience: 'mib', experienceGrants: ['aros'], mibEnabled: true });
    expect(decision.experience).toBe('aros');
  });

  it('uses developer desktop intent only when MIB is available', () => {
    expect(decideExperienceRoute({ ...base, sourceIntent: 'developer-desktop' }, { experienceGrants: ['aros'] }).experience).toBe('aros');
    expect(decideExperienceRoute({ ...base, sourceIntent: 'developer-desktop' }, { experienceGrants: ['aros', 'mib'], mibEnabled: true }).experience).toBe('mib');
  });

  it('rejects external return targets', () => {
    const decision = decideExperienceRoute({ ...base, returnTo: '//evil.example' }, { experienceGrants: ['aros'] });
    expect(decision.targetUrl).toBe('https://app.aros.live/dashboard');
  });
});
