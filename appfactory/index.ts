// ── App Factory (Phase 2 — tenant app substrate) ────────────────────────────
// Provisioning + lifecycle for factory-generated per-tenant apps hosted on
// *.apps.aros.live. See shreai docs/projects/APP-FACTORY-TENANT-SUBSTRATE.md.

export * from './types.js';
export {
  appSchemaName,
  appRoleName,
  containerName,
  generateRolePassword,
  renderProvisionSql,
  provisionApp,
  addBuildCredits,
} from './provision.js';
export {
  LEGAL_TRANSITIONS,
  assertTransition,
  transitionApp,
  promoteToPreview,
  approveGoLive,
  demoteToDraft,
  retireApp,
} from './promote.js';
