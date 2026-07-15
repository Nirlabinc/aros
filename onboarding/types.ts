// ── AROS Onboarding Types ─────────────────────────────────────────
// Unified 8-step onboarding + multi-workspace + white-label branding

// ── Onboarding Steps ──────────────────────────────────────────────

export type OnboardingStep =
  | 'welcome'
  | 'marketplace'
  | 'configure'
  | 'stores'
  | 'model'
  | 'agents'
  | 'sync'
  | 'dashboard';

export const STEP_ORDER: OnboardingStep[] = [
  'welcome',
  'marketplace',
  'configure',
  'stores',
  'model',
  'agents',
  'sync',
  'dashboard',
];

export type OnboardingPath = 'operator' | 'developer' | 'partner';

// ── Onboarding State ──────────────────────────────────────────────

export interface OnboardingState {
  tenantId: string;
  workspaceId?: string;
  step: OnboardingStep | 'complete';
  completedSteps: OnboardingStep[];
  path: OnboardingPath;

  // Step 1: Welcome
  welcome?: {
    companyName: string;
    path: OnboardingPath;
    workspaceName?: string;
  };

  // Step 2: Marketplace — selected connector nodes
  selectedNodes: SelectedNode[];

  // Step 3: Configure — credentials per node
  nodeConfigs: Record<string, Record<string, unknown>>;

  // Step 4: Stores — discovered & selected
  discoveredStores: DiscoveredStore[];
  selectedStoreIds: string[];

  // Step 5: AI Model
  modelConfig: ModelConfig;

  // Step 6: Agent Fleet
  selectedAgents: string[];
  selectedBundle?: string;

  // Step 7: Sync — tracked separately via events
  syncStatus?: SyncStatus;
}

// ── Connector Nodes ───────────────────────────────────────────────

export interface SelectedNode {
  nodeId: string;
  name: string;
  category: string;
}

export interface ConfigField {
  type: 'string' | 'number' | 'boolean' | 'select';
  required?: boolean;
  label: string;
  placeholder?: string;
  secret?: boolean;
  default?: unknown;
  options?: { label: string; value: string }[];
  description?: string;
}

export interface DiscoveredStore {
  id: string;
  name: string;
  address?: string;
  city?: string;
  state?: string;
  posSystem: string;
  nodeId: string;
}

// ── AI Model ──────────────────────────────────────────────────────

export interface ModelConfig {
  provider: 'aum' | 'ollama' | 'anthropic' | 'openai' | 'custom';
  model?: string;
  apiKey?: string;
  endpoint?: string;
}

// ── Agent Fleet ───────────────────────────────────────────────────

export interface AgentOption {
  id: string;
  name: string;
  role: string;
  description: string;
  priceMonthly: number;
  included: boolean; // free with platform
  recommended: boolean;
}

export interface AgentBundle {
  id: string;
  name: string;
  description: string;
  agents: string[];
  priceMonthly: number;
  savings: string;
}

// ── Sync Status ───────────────────────────────────────────────────

export interface SyncStatus {
  phase: 'connecting' | 'importing' | 'analyzing' | 'complete' | 'error';
  stores: StoreSyncProgress[];
  startedAt: string;
  completedAt?: string;
  error?: string;
}

export interface StoreSyncProgress {
  storeId: string;
  storeName: string;
  status: 'pending' | 'importing' | 'complete' | 'error';
  transactionsImported: number;
  progress: number; // 0-100
}

// ── Tenant ────────────────────────────────────────────────────────

export type TenantPlan = 'free' | 'starter' | 'pro' | 'enterprise';
export type CompanyType = 'direct' | 'reseller' | 'sub-tenant';
export type UserRole = 'superadmin' | 'owner' | 'admin' | 'manager' | 'viewer';

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  plan: TenantPlan;
  companyType: CompanyType;
  parentTenantId?: string; // for reseller sub-tenants
  ownerUserId: string;
  onboardingComplete: boolean;
  brandingId?: string;
  createdAt: string;
}

export interface TenantPlanLimits {
  plan: TenantPlan;
  maxWorkspaces: number;
  maxStoresPerWorkspace: number;
  maxUsersPerWorkspace: number;
  maxAgents: number;
  customBranding: boolean;
  customDomain: boolean;
  apiAccess: boolean;
  whiteLabel: boolean;
  sla: boolean;
}

export const PLAN_LIMITS: Record<TenantPlan, TenantPlanLimits> = {
  free: {
    plan: 'free',
    maxWorkspaces: 1,
    maxStoresPerWorkspace: 999,
    maxUsersPerWorkspace: 999,
    maxAgents: 999,
    customBranding: false,
    customDomain: false,
    apiAccess: false,
    whiteLabel: false,
    sla: false,
  },
  starter: {
    plan: 'starter',
    maxWorkspaces: 1,
    maxStoresPerWorkspace: 1,
    maxUsersPerWorkspace: 3,
    maxAgents: 5,
    customBranding: false,
    customDomain: false,
    apiAccess: false,
    whiteLabel: false,
    sla: false,
  },
  pro: {
    plan: 'pro',
    maxWorkspaces: 5,
    maxStoresPerWorkspace: 50,
    maxUsersPerWorkspace: 10,
    maxAgents: 14,
    customBranding: true,
    customDomain: false,
    apiAccess: true,
    whiteLabel: false,
    sla: false,
  },
  enterprise: {
    plan: 'enterprise',
    maxWorkspaces: 999,
    maxStoresPerWorkspace: 999,
    maxUsersPerWorkspace: 999,
    maxAgents: 999,
    customBranding: true,
    customDomain: true,
    apiAccess: true,
    whiteLabel: true,
    sla: true,
  },
};

// ── Workspace ─────────────────────────────────────────────────────

export interface Workspace {
  id: string;
  tenantId: string;
  name: string;
  slug: string;
  type: WorkspaceType;
  status: 'active' | 'suspended' | 'archived';
  storeCount: number;
  memberCount: number;
  agentCount: number;
  connectorNodeId?: string; // which marketplace node powers this workspace
  connectorConfig?: Record<string, unknown>;
  createdAt: string;
}

export type WorkspaceType = 'retail' | 'qsr' | 'grocery' | 'fuel' | 'custom';

export interface WorkspaceMember {
  id: string;
  workspaceId: string;
  userId: string;
  email: string;
  name: string;
  role: UserRole;
  storeScope: string[] | 'all'; // which stores this user can see
  invitedAt: string;
  acceptedAt?: string;
}

export interface WorkspaceAgent {
  id: string;
  workspaceId: string;
  agentId: string;
  agentName: string;
  status: 'active' | 'paused' | 'error';
  assignedAt: string;
}

export interface WorkspaceStore {
  id: string;
  workspaceId: string;
  externalId: string; // POS system's store ID
  name: string;
  address?: string;
  city?: string;
  state?: string;
  posSystem: string;
  syncStatus: 'syncing' | 'synced' | 'error' | 'pending';
  lastSyncAt?: string;
  transactionCount: number;
}

// ── White-Label Branding ──────────────────────────────────────────

export interface BrandingConfig {
  id: string;
  tenantId: string;

  // Brand identity
  brandName: string;
  brandTagline?: string;
  brandDomain?: string;
  brandSupportEmail?: string;
  brandCopyright?: string;

  // Agent identity
  agentName: string;
  agentAvatar?: string;
  agentGreeting?: string;
  agentPersonality: 'professional' | 'friendly' | 'minimal' | 'custom';

  // Visual theme
  theme: {
    colors: {
      primary: string;
      secondary: string;
      accent: string;
      background: string;
      surface: string;
      text: string;
      textSecondary: string;
      border: string;
      error: string;
      warning: string;
      success: string;
    };
    fonts?: {
      heading?: string;
      body?: string;
      mono?: string;
    };
    borderRadius?: {
      small?: string;
      medium?: string;
      large?: string;
    };
  };

  // Logos
  logoPrimary?: string;
  logoIcon?: string;
  logoDark?: string;

  // Layout
  layout?: {
    sidebar?: 'left' | 'right';
    navigation?: 'sidebar' | 'top' | 'hybrid';
    density?: 'compact' | 'default' | 'comfortable';
  };

  // Feature visibility
  features?: {
    marketplace?: boolean;
    updates?: boolean;
    analytics?: boolean;
    agentChat?: boolean;
    settings?: boolean;
  };

  // Powered by
  poweredByVisible: boolean;
  poweredByText?: string;

  // Custom domain
  customDomain?: string;
}

// ── Default Branding ──────────────────────────────────────────────

export const DEFAULT_BRANDING: Omit<BrandingConfig, 'id' | 'tenantId'> = {
  brandName: 'AROS',
  brandTagline: 'Agentic Retail Operating System',
  brandSupportEmail: '',
  brandCopyright: '© 2026 Nirlab Inc. All rights reserved.',

  agentName: 'AROS',
  agentGreeting: 'What do you need?',
  agentPersonality: 'professional',

  theme: {
    colors: {
      primary: '#2563eb',
      secondary: '#3B82F6',
      accent: '#10B981',
      background: '#FFFFFF',
      surface: '#F8FAFC',
      text: '#0F172A',
      textSecondary: '#64748B',
      border: '#E2E8F0',
      error: '#EF4444',
      warning: '#F59E0B',
      success: '#22C55E',
    },
    fonts: {
      heading: 'Inter, system-ui, sans-serif',
      body: 'Inter, system-ui, sans-serif',
      mono: 'JetBrains Mono, monospace',
    },
    borderRadius: {
      small: '6px',
      medium: '10px',
      large: '16px',
    },
  },

  poweredByVisible: true,
  poweredByText: 'Powered by AROS',

  features: {
    marketplace: true,
    updates: true,
    analytics: true,
    agentChat: true,
    settings: true,
  },
};
