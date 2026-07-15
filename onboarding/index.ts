// ── AROS Unified Onboarding ───────────────────────────────────────
// 8-step wizard: welcome → marketplace → configure → stores →
//                model → agents → sync → dashboard
//
// Also handles "Add Workspace" flow (steps 2-7 under existing tenant)

import type {
  OnboardingState,
  OnboardingStep,
  OnboardingPath,
  SelectedNode,
  DiscoveredStore,
  ModelConfig,
  SyncStatus,
  Tenant,
  TenantPlan,
  Workspace,
  WorkspaceType,
  BrandingConfig,
  PLAN_LIMITS as PlanLimitsType,
} from './types.js';

import { STEP_ORDER, PLAN_LIMITS, DEFAULT_BRANDING } from './types.js';

export type {
  OnboardingState,
  OnboardingStep,
  OnboardingPath,
  SelectedNode,
  DiscoveredStore,
  ModelConfig,
  SyncStatus,
  Tenant,
  TenantPlan,
  Workspace,
  WorkspaceType,
  BrandingConfig,
} from './types.js';
export { STEP_ORDER, PLAN_LIMITS, DEFAULT_BRANDING } from './types.js';

// ── Init ──────────────────────────────────────────────────────────

/** Start fresh onboarding for a new tenant. */
export function initOnboarding(tenantId: string): OnboardingState {
  return {
    tenantId,
    step: 'welcome',
    completedSteps: [],
    path: 'operator',
    selectedNodes: [],
    nodeConfigs: {},
    discoveredStores: [],
    selectedStoreIds: [],
    modelConfig: { provider: 'aum', model: 'shre-70b', endpoint: 'http://127.0.0.1:5480/v1' },
    selectedAgents: [],
  };
}

/** Start "Add Workspace" flow (skips welcome, starts at marketplace). */
export function initAddWorkspace(tenantId: string, workspaceId?: string): OnboardingState {
  return {
    tenantId,
    workspaceId,
    step: 'marketplace',
    completedSteps: ['welcome'],
    path: 'operator',
    selectedNodes: [],
    nodeConfigs: {},
    discoveredStores: [],
    selectedStoreIds: [],
    modelConfig: { provider: 'aum', model: 'shre-70b', endpoint: 'http://127.0.0.1:5480/v1' },
    selectedAgents: [],
  };
}

// ── Step Management ───────────────────────────────────────────────

/** Advance to the next step after completing current. */
export function advanceStep(
  state: OnboardingState,
  completedStep: OnboardingStep,
): OnboardingState {
  const completedSteps = state.completedSteps.includes(completedStep)
    ? state.completedSteps
    : [...state.completedSteps, completedStep];

  const currentIndex = STEP_ORDER.indexOf(completedStep);
  const nextStep =
    currentIndex < STEP_ORDER.length - 1 ? STEP_ORDER[currentIndex + 1] : ('complete' as const);

  return { ...state, step: nextStep, completedSteps };
}

/** Go back to a previous step. */
export function goToStep(state: OnboardingState, targetStep: OnboardingStep): OnboardingState {
  return { ...state, step: targetStep };
}

/** Check if onboarding is fully complete. */
export function isOnboardingComplete(state: OnboardingState): boolean {
  return state.step === 'complete';
}

/** Get the current step index (0-based). */
export function getStepIndex(step: OnboardingStep | 'complete'): number {
  if (step === 'complete') return STEP_ORDER.length;
  return STEP_ORDER.indexOf(step);
}

/** Get progress as a percentage. */
export function getProgress(state: OnboardingState): number {
  return Math.round((state.completedSteps.length / STEP_ORDER.length) * 100);
}

// ── Step Data Updates ─────────────────────────────────────────────

/** Save welcome step data. */
export function setWelcomeData(
  state: OnboardingState,
  companyName: string,
  path: OnboardingPath,
  workspaceName?: string,
): OnboardingState {
  return {
    ...state,
    path,
    welcome: { companyName, path, workspaceName },
  };
}

/** Add a connector node selection. */
export function addNode(state: OnboardingState, node: SelectedNode): OnboardingState {
  if (state.selectedNodes.some((n) => n.nodeId === node.nodeId)) return state;
  return {
    ...state,
    selectedNodes: [...state.selectedNodes, node],
  };
}

/** Remove a connector node selection. */
export function removeNode(state: OnboardingState, nodeId: string): OnboardingState {
  return {
    ...state,
    selectedNodes: state.selectedNodes.filter((n) => n.nodeId !== nodeId),
    nodeConfigs: Object.fromEntries(
      Object.entries(state.nodeConfigs).filter(([k]) => k !== nodeId),
    ),
  };
}

/** Save configuration for a connector node. */
export function setNodeConfig(
  state: OnboardingState,
  nodeId: string,
  config: Record<string, unknown>,
): OnboardingState {
  return {
    ...state,
    nodeConfigs: { ...state.nodeConfigs, [nodeId]: config },
  };
}

/** Set discovered stores from connector. */
export function setDiscoveredStores(
  state: OnboardingState,
  stores: DiscoveredStore[],
): OnboardingState {
  return { ...state, discoveredStores: stores };
}

/** Toggle store selection. */
export function toggleStore(state: OnboardingState, storeId: string): OnboardingState {
  const selected = state.selectedStoreIds.includes(storeId)
    ? state.selectedStoreIds.filter((id) => id !== storeId)
    : [...state.selectedStoreIds, storeId];
  return { ...state, selectedStoreIds: selected };
}

/** Select all discovered stores. */
export function selectAllStores(state: OnboardingState): OnboardingState {
  return {
    ...state,
    selectedStoreIds: state.discoveredStores.map((s) => s.id),
  };
}

/** Set AI model configuration. */
export function setModelConfig(state: OnboardingState, config: ModelConfig): OnboardingState {
  return { ...state, modelConfig: config };
}

/** Toggle agent selection. */
export function toggleAgent(state: OnboardingState, agentId: string): OnboardingState {
  const selected = state.selectedAgents.includes(agentId)
    ? state.selectedAgents.filter((id) => id !== agentId)
    : [...state.selectedAgents, agentId];
  return { ...state, selectedAgents: selected };
}

/** Select an agent bundle (replaces individual selections). */
export function selectBundle(
  state: OnboardingState,
  bundleId: string,
  agentIds: string[],
): OnboardingState {
  return {
    ...state,
    selectedBundle: bundleId,
    selectedAgents: agentIds,
  };
}

/** Update sync status. */
export function setSyncStatus(state: OnboardingState, syncStatus: SyncStatus): OnboardingState {
  return { ...state, syncStatus };
}

// ── Validation ────────────────────────────────────────────────────

/** Check if a step has all required data to proceed. */
export function canAdvance(state: OnboardingState): boolean {
  switch (state.step) {
    case 'welcome':
      return !!state.welcome?.companyName && !!state.welcome?.path;

    case 'marketplace':
      return state.selectedNodes.length > 0;

    case 'configure':
      // Every selected node must have a config entry
      return state.selectedNodes.every((n) => {
        const config = state.nodeConfigs[n.nodeId];
        return config && Object.keys(config).length > 0;
      });

    case 'stores':
      return state.selectedStoreIds.length > 0;

    case 'model':
      if (state.modelConfig.provider === 'aum' || state.modelConfig.provider === 'ollama') return true;
      return !!state.modelConfig.apiKey;

    case 'agents':
      return state.selectedAgents.length > 0;

    case 'sync':
      return state.syncStatus?.phase === 'complete';

    case 'dashboard':
      return true;

    default:
      return false;
  }
}

// ── Plan Enforcement ──────────────────────────────────────────────

/** Check if tenant can create another workspace. */
export function canCreateWorkspace(plan: TenantPlan, currentCount: number): boolean {
  return currentCount < PLAN_LIMITS[plan].maxWorkspaces;
}

/** Check if workspace can add more stores. */
export function canAddStores(plan: TenantPlan, currentCount: number, adding: number): boolean {
  return currentCount + adding <= PLAN_LIMITS[plan].maxStoresPerWorkspace;
}

/** Check if workspace can invite more users. */
export function canInviteUser(plan: TenantPlan, currentCount: number): boolean {
  return currentCount < PLAN_LIMITS[plan].maxUsersPerWorkspace;
}

/** Check if tenant plan supports a feature. */
export function hasFeature(plan: TenantPlan, feature: keyof typeof PLAN_LIMITS.free): boolean {
  return !!PLAN_LIMITS[plan][feature];
}
