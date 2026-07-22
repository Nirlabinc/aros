import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { decideExperienceRoute, verifyHandoff } from '../../src/auth/experience-routing.js';

function arg(name: string): string | undefined {
  const flag = `--${name}`;
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

async function main() {
  const fixturePath = arg('fixture');
  const output = arg('output') || 'docs/missions/evidence/aros-mib-experience-routing-live-sync/integration-smoke.json';
  const secret = process.env.AROS_MIB_HANDOFF_SECRET || 'local-smoke-secret';
  process.env.AROS_MIB_HANDOFF_SECRET = secret;
  const fixture = fixturePath ? JSON.parse(await readFile(fixturePath, 'utf8')) : {};
  const workspaceId = fixture.workspaceId || '11111111-1111-4111-8111-111111111111';
  const email = fixture.principalEmail || 'experience-routing-smoke@aros.live';
  const base = { userId: 'local-user', subject: 'shre-id-subject', email, workspaceId, role: 'owner' };
  const arosOnly = decideExperienceRoute(base, { experienceGrants: ['aros'], mibEnabled: false });
  const mibEnabled = decideExperienceRoute(base, { preferredExperience: 'mib', experienceGrants: ['aros', 'mib'], mibEnabled: true });
  const standardDesktop = decideExperienceRoute({ ...base, sourceIntent: 'standard-desktop' }, { experienceGrants: ['aros', 'mib'], mibEnabled: true });
  const developerDesktopWithGrant = decideExperienceRoute({ ...base, sourceIntent: 'developer-desktop' }, { experienceGrants: ['aros', 'mib'], mibEnabled: true });
  const developerDesktopWithoutGrant = decideExperienceRoute({ ...base, sourceIntent: 'developer-desktop' }, { experienceGrants: ['aros'], mibEnabled: true });
  const internalBuilderWithGrant = decideExperienceRoute({ ...base, sourceIntent: 'internal-builder' }, { experienceGrants: ['aros', 'mib'], mibEnabled: true });
  const handoff = new URL(mibEnabled.targetUrl).searchParams.get('handoff');
  const decoded = handoff ? verifyHandoff(secret, handoff) : null;
  const redactDecision = (decision: typeof arosOnly) => {
    const url = new URL(decision.targetUrl);
    if (url.searchParams.has('handoff')) url.searchParams.set('handoff', '[redacted]');
    return { ...decision, targetUrl: url.toString() };
  };
  const report = {
    generatedAt: new Date().toISOString(),
    fixture: { workspaceId, email },
    checks: {
      arosOnlyFallsBackToAros: arosOnly.experience === 'aros',
      mibGrantRoutesToMib: mibEnabled.experience === 'mib',
      mibTargetUsesOidcStart: new URL(mibEnabled.targetUrl).pathname === '/api/auth/shre/start',
      handoffPresent: Boolean(handoff),
      handoffWorkspaceMatches: decoded?.workspaceId === workspaceId,
      handoffEmailMatches: decoded?.email === email,
      standardDesktopDefaultsToAros: standardDesktop.experience === 'aros',
      developerDesktopWithMibGrantDefaultsToMib: developerDesktopWithGrant.experience === 'mib',
      developerDesktopWithoutMibGrantFallsBackToAros: developerDesktopWithoutGrant.experience === 'aros',
      internalBuilderWithMibGrantDefaultsToMib: internalBuilderWithGrant.experience === 'mib',
    },
    decisions: {
      arosOnly: redactDecision(arosOnly),
      mibEnabled: redactDecision(mibEnabled),
      standardDesktop: redactDecision(standardDesktop),
      developerDesktopWithGrant: redactDecision(developerDesktopWithGrant),
      developerDesktopWithoutGrant: redactDecision(developerDesktopWithoutGrant),
      internalBuilderWithGrant: redactDecision(internalBuilderWithGrant),
    },
  };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  const failed = Object.entries(report.checks).filter(([, ok]) => !ok);
  if (failed.length) {
    console.error(`Failed checks: ${failed.map(([name]) => name).join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify(report.checks, null, 2));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
