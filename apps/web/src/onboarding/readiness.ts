/**
 * Readiness aggregation — pure mapping from already-fetched API payloads to the
 * four readiness rows shown on the final onboarding screen. Kept free of React
 * and fetch so the status rules are unit-testable and never fabricate data:
 * every row is derived strictly from real backend shapes, defaulting to an
 * honest "pending"/"action" state when a signal is absent.
 */

export type ReadinessState = 'ready' | 'pending' | 'action';

export interface ReadinessItem {
  key: 'model' | 'store' | 'sync' | 'skills';
  label: string;
  state: ReadinessState;
  detail: string;
}

/** Minimal shapes we read from the existing endpoints (defensive/partial). */
export interface ConnectorLike { status?: string | null; type?: string | null; name?: string | null }
export interface ResourceLike { status?: string | null; name?: string | null }

export interface ReadinessInput {
  /** step_data.model persisted during the model step. */
  model: { mode?: 'recommended' | 'byom'; label?: string } | null;
  /** GET /api/connectors → connectors[]. */
  connectors: ConnectorLike[];
  /** GET /api/store/summary → { connected }. */
  storeSummaryConnected: boolean;
  /** GET /api/resources/skill → resources[]. */
  skills: ResourceLike[];
}

const READY_CONNECTOR = new Set(['connected', 'healthy']);
const PENDING_CONNECTOR = new Set(['pending', 'configuring', 'testing', 'syncing']);
const ACTIVE_RESOURCE = new Set(['active', 'ready', 'running']);

export function computeReadiness(input: ReadinessInput): ReadinessItem[] {
  return [
    modelItem(input.model),
    storeItem(input.connectors),
    syncItem(input.connectors, input.storeSummaryConnected),
    skillsItem(input.skills),
  ];
}

function modelItem(model: ReadinessInput['model']): ReadinessItem {
  if (!model?.mode) {
    return { key: 'model', label: 'AI model', state: 'action', detail: 'Choose a model to power your agents.' };
  }
  if (model.mode === 'byom') {
    return { key: 'model', label: 'AI model', state: 'ready', detail: model.label || 'Your own provider is configured.' };
  }
  return { key: 'model', label: 'AI model', state: 'ready', detail: model.label || 'AROS-managed recommended model.' };
}

function storeItem(connectors: ConnectorLike[]): ReadinessItem {
  const connected = connectors.some((c) => READY_CONNECTOR.has(String(c.status)));
  if (connected) {
    return { key: 'store', label: 'Store connection', state: 'ready', detail: 'A point of sale is connected.' };
  }
  const pending = connectors.some((c) => PENDING_CONNECTOR.has(String(c.status)));
  if (pending) {
    return { key: 'store', label: 'Store connection', state: 'pending', detail: 'Connection saved — finishing verification.' };
  }
  return { key: 'store', label: 'Store connection', state: 'action', detail: 'Connect a store to work with live numbers (optional).' };
}

function syncItem(connectors: ConnectorLike[], storeSummaryConnected: boolean): ReadinessItem {
  const connected = connectors.some((c) => READY_CONNECTOR.has(String(c.status)));
  if (storeSummaryConnected) {
    return { key: 'sync', label: 'Data sync', state: 'ready', detail: 'Live store data is available.' };
  }
  if (connected) {
    return { key: 'sync', label: 'Data sync', state: 'pending', detail: 'First read-only sync is in progress.' };
  }
  return { key: 'sync', label: 'Data sync', state: 'pending', detail: 'Starts automatically after a store connects.' };
}

function skillsItem(skills: ResourceLike[]): ReadinessItem {
  const active = skills.filter((s) => ACTIVE_RESOURCE.has(String(s.status)));
  if (active.length > 0) {
    return { key: 'skills', label: 'Agent skills', state: 'ready', detail: `${active.length} skill${active.length === 1 ? '' : 's'} active.` };
  }
  if (skills.length > 0) {
    return { key: 'skills', label: 'Agent skills', state: 'pending', detail: `${skills.length} skill${skills.length === 1 ? '' : 's'} provisioning.` };
  }
  return { key: 'skills', label: 'Agent skills', state: 'pending', detail: 'Default skills activate after your first sync.' };
}

/** Everything the journey strictly requires is satisfied (model + store live). */
export function isFullyReady(items: ReadinessItem[]): boolean {
  return items.every((i) => i.state === 'ready');
}

/** The dashboard is always reachable — connecting a store stays optional. */
export function canEnterDashboard(items: ReadinessItem[]): boolean {
  return items.find((i) => i.key === 'model')?.state === 'ready';
}
