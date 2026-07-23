// Content for the chat-first redesign. Section data mirrors the app's real
// catalogs (CapabilityCatalog skills/agents, ConnectionsHub POS/app providers,
// AIModels providers, AdministrationPage members) so the redesigned panels show
// the same things the current pages do — just in the new design and ready to
// swap the static arrays for live fetches at cutover.

export type SectionKey =
  | 'chat' | 'stores' | 'marketplace' | 'apps' | 'connectors' | 'plugins' | 'skills' | 'agents'
  | 'models' | 'devices' | 'permissions' | 'health' | 'documents' | 'team' | 'billing' | 'usage' | 'settings'
  | 'notifications' | 'wallet' | 'profile' | 'developers'
  | 'edi-invoices';

export interface NavItem { key: SectionKey; label: string; glyph: string; count?: number; }

export const PRIMARY_NAV: NavItem[] = [
  { key: 'chat', label: 'Chat', glyph: 'C' },
  { key: 'stores', label: 'Stores', glyph: 'St' },
  // Marketplace/Connectors/Plugins were removed by the 07-20 validation sweep
  // because they had no real panes; they're back by founder direction now that
  // each renders a real page (MarketplacePage / ConnectorsPage / PluginsPage).
  // Marketplace = discover/install; Apps = active apps A→Z.
  { key: 'marketplace', label: 'Marketplace', glyph: 'Mk' },
  { key: 'apps', label: 'Apps', glyph: 'Ap' },
  { key: 'connectors', label: 'Connectors', glyph: 'Co' },
  { key: 'plugins', label: 'Plugins', glyph: 'Pl' },
  { key: 'skills', label: 'Skills', glyph: 'Sk', count: 5 },
  { key: 'agents', label: 'Agents', glyph: 'Ag', count: 5 },
  { key: 'models', label: 'Models', glyph: 'M' },
  { key: 'devices', label: 'Computers', glyph: 'PC' },
  { key: 'permissions', label: 'Permissions', glyph: 'P' },
  { key: 'health', label: 'Connection Health', glyph: 'H' },
];

// In-shell marketplace apps: rendered inside the shell when the workspace has
// an active entitlement (installed from Marketplace), surfaced as dynamic nav
// entries — not part of the fixed workspace nav.
export const EMBEDDED_APP_NAV: Record<'documents' | 'edi-invoices', NavItem> = {
  documents: { key: 'documents', label: 'Documents', glyph: 'Dc' },
  'edi-invoices': { key: 'edi-invoices', label: 'EDI Invoices', glyph: 'ED' },
};

export const WORKSPACE_NAV: NavItem[] = [
  { key: 'team', label: 'Team', glyph: 'Tm' },
  { key: 'billing', label: 'Billing', glyph: 'Bi' },
  { key: 'wallet', label: 'Wallet', glyph: 'Wa' },
  { key: 'usage', label: 'Usage', glyph: 'Us' },
  { key: 'settings', label: 'Settings', glyph: 'Se' },
  { key: 'notifications', label: 'Notifications', glyph: 'No' },
];

export const HEALTH = { healthy: 2, degraded: 1, down: 1 };
export const USER = { name: 'Dana Reyes', role: 'Owner', workspace: 'Five Points', initials: 'DR' };
export const ROLES = ['Owner', 'Admin', 'Member'] as const;

export interface ChatMsg { from: 'shre' | 'me'; text: string; meta?: string; agent?: string; tools?: string[]; }
export const CONCIERGE_SEED: ChatMsg[] = [
  { from: 'shre', text: 'I’m Shre — your store concierge. Ask me anything, like “How were sales yesterday?” or “Which SKUs are running low?” You can connect a register whenever you’re ready. I’ll never block the chat on setup.', meta: 'Shre · Local' },
  { from: 'shre', text: 'RapidRMS is connected — I can see all 5 stores and live sales are flowing. Ask me “How were sales yesterday?” whenever you’re ready.', meta: 'Shre · Local' },
];
// Read-only suggestions only: a mutating example ("raise prices…") beside
// harmless questions blurred analysis vs action for new users (UX review).
export const SUGGESTIONS = ['How were sales yesterday?', 'Which SKUs are low?', 'Compare this week to last week'];

// Recallable conversation history (right-pane History tab). Preview uses canned
// threads; wired build lists the tenant's conversations from the chat store.
export interface Conversation { id: string; title: string; preview: string; when: string; messages: ChatMsg[]; }
export const CONVERSATIONS: Conversation[] = [
  {
    id: 'c1', title: 'Yesterday’s sales across stores', preview: '$18,240 net · up 4.2% w/w · Harbor led', when: '2h ago',
    messages: [
      { from: 'me', text: 'How were sales yesterday?' },
      { from: 'shre', text: 'Yesterday you did $18,240 across all 5 stores — up 4.2% w/w. Harbor led at $4,910; Elm St Express lagged at $2,180.', meta: 'Shre · Local' },
    ],
  },
  {
    id: 'c2', title: 'Reorder cold brew — Oak Ave', preview: 'Drafted a PO for 24 units, awaiting approval', when: 'Yesterday',
    messages: [
      { from: 'me', text: 'Oak Ave is low on cold brew — can you reorder?' },
      { from: 'shre', text: 'Oak Ave is down to 6 units of cold brew (par 30). I’ve drafted a purchase order for 24 units — want me to send it for approval?', meta: 'Shre · Local' },
    ],
  },
  {
    id: 'c3', title: 'Raise carton prices 3%', preview: 'Staged across all 5 stores · approval-gated', when: 'Mon',
    messages: [
      { from: 'me', text: 'Raise carton prices 3% at all stores' },
      { from: 'shre', text: 'That’s a 3% increase on 42 carton SKUs across all 5 stores. Nothing changes until you approve — review the price sheet?', meta: 'Shre · Local' },
    ],
  },
  {
    id: 'c4', title: 'Which SKUs are low?', preview: '4 SKUs below reorder point in 3 stores', when: 'Mon',
    messages: [
      { from: 'me', text: 'Which SKUs are low?' },
      { from: 'shre', text: '4 SKUs are below reorder point: Marlboro Gold 100s (Harbor), Monster Energy 16oz (Main St), Coca-Cola 20oz (Oak Ave), Red Bull 12oz (3rd St Express).', meta: 'Shre · Local' },
    ],
  },
];

export type Status = 'on' | 'warn' | 'off';
export interface Stat { value: string | number; label: string; }
export interface Card { icon: string; title: string; desc: string; status: Status; tag: string; cta: string; }
export interface Row { mark: string; title: string; sub: string; status: Status; statusLabel: string; action: string; }
export interface FormField { label: string; value: string; type?: 'text' | 'select'; options?: string[]; }

export interface SectionSpec {
  eyebrow: string;
  lead: string;
  primaryCta?: string;
  stats?: Stat[];
  cards?: Card[];
  rows?: Row[];
  form?: FormField[];
  note?: { title: string; body: string };
}

const s = (v: Status, label: string): [Status, string] => [v, label];

export const SECTIONS: Record<Exclude<SectionKey, 'chat'>, SectionSpec> = {
  'edi-invoices': {
    eyebrow: 'RapidRMS', primaryCta: 'Upload invoice',
    lead: 'Electronic supplier invoices from RapidRMS — review received line items, upload a new EDI file, or revert a receiving into the register.',
    stats: [{ value: 3, label: 'Invoices' }, { value: 2, label: 'Suppliers' }, { value: 1, label: 'Reverted' }],
    rows: [
      { mark: 'MC', title: 'McLane_0714.edi', sub: 'McLane · 837 · Received', ...rowStatus(s('on', 'Received')), action: 'View' },
      { mark: 'CO', title: 'CoreMark_0713.csv', sub: 'Core-Mark · CSV · Received', ...rowStatus(s('on', 'Received')), action: 'View' },
    ],
  },
  marketplace: { eyebrow: 'Marketplace', lead: 'Browse apps, connectors, plugins, skills, and agents.', rows: [] },
  connectors: { eyebrow: 'Activated connectors', lead: 'Connectors enabled for this workspace.', rows: [] },
  plugins: { eyebrow: 'Activated plugins', lead: 'Plugins enabled for this workspace.', rows: [] },
  skills: {
    eyebrow: 'Shreai router', primaryCta: 'Add skill',
    lead: 'Versioned, reusable procedures your agents invoke through policy-controlled tools. Turn one on and Shre can call it in chat immediately — write actions always stay behind an approval gate.',
    stats: [{ value: 5, label: 'Available' }, { value: 2, label: 'Active' }, { value: 3, label: 'Not configured' }],
    cards: [
      { icon: '📊', title: 'Daily Sales Summary', desc: 'Queries mapped POS stores and produces a cited summary each morning.', status: 'on', tag: 'Read only', cta: 'Configure' },
      { icon: '📦', title: 'Inventory Reorder', desc: 'Builds reorder recommendations from stock velocity, drafts a PO for approval.', status: 'on', tag: 'Draft action', cta: 'Configure' },
      { icon: '🏷️', title: 'Price Update', desc: 'Submits a POS price change across selected stores — after your approval.', status: 'off', tag: 'Write action', cta: 'Enable' },
      { icon: '💬', title: 'Support Triage', desc: 'Classifies incoming tickets and drafts responses from your data.', status: 'off', tag: 'Draft action', cta: 'Enable' },
      { icon: '🌙', title: 'Store Closeout', desc: 'Runs end-of-day checks and reports exceptions across every store.', status: 'off', tag: 'Workflow', cta: 'Enable' },
    ],
  },
  agents: {
    eyebrow: 'Shreai router', primaryCta: 'Create agent',
    lead: 'Agents coordinate goals and invoke approved skills. Each one acts only within the scope you grant — talk to any of them from chat, or let them run in the background and report back.',
    stats: [{ value: 5, label: 'Available' }, { value: 2, label: 'Running' }, { value: 3, label: 'Paused' }],
    cards: [
      { icon: '🛒', title: 'Store Operations Agent', desc: 'Monitors daily operations, exceptions, and store health across all locations.', status: 'on', tag: 'Operations', cta: 'Configure' },
      { icon: '🔁', title: 'Inventory Agent', desc: 'Tracks stock and drafts replenishment actions overnight for your sign-off.', status: 'on', tag: 'Inventory', cta: 'Configure' },
      { icon: '🔎', title: 'Pricing Agent', desc: 'Proposes approval-gated POS price changes from margin and competitor signals.', status: 'off', tag: 'Approval required', cta: 'Start' },
      { icon: '🎧', title: 'Customer Support Agent', desc: 'Handles support questions using connected systems and your store data.', status: 'off', tag: 'Support', cta: 'Start' },
      { icon: '📒', title: 'Finance Agent', desc: 'Reconciles POS and accounting activity, flags mismatches for review.', status: 'off', tag: 'Finance', cta: 'Start' },
    ],
  },
  stores: {
    eyebrow: 'Connections', primaryCta: 'Connect POS',
    lead: 'Connect your POS, discover its stores, and control exactly what Shre can read and change. Credentials are sealed in the Shreai vault. We support RapidRMS and Verifone Commander today.',
    stats: [{ value: 1, label: 'Connected' }, { value: 5, label: 'Mapped stores' }, { value: 2, label: 'Providers' }],
    rows: [
      { mark: 'RA', title: 'RapidRMS', sub: 'Main St · Oak Ave · 3rd St Express · Harbor · Elm St Express', ...rowStatus(s('on', 'Connected')), action: 'Manage' },
      { mark: 'VF', title: 'Verifone Commander', sub: 'Site controller · token expiring soon', ...rowStatus(s('warn', 'Needs attention')), action: 'Fix' },
    ],
  },
  apps: {
    eyebrow: 'Connections', primaryCta: 'Connect app',
    lead: 'Connect the apps Shre can read and act in — accounting, messaging, storage, and CRM. Map each account to a workspace or store.',
    stats: [{ value: 0, label: 'Connected' }, { value: 14, label: 'Available' }, { value: 0, label: 'Mapped stores' }],
    rows: [
      { mark: 'QB', title: 'QuickBooks', sub: 'Accounting · reconcile POS to books', ...rowStatus(s('off', 'Available')), action: 'Connect' },
      { mark: 'XE', title: 'Xero', sub: 'Accounting', ...rowStatus(s('off', 'Available')), action: 'Connect' },
      { mark: 'SL', title: 'Slack', sub: 'Alerts and approval workflows', ...rowStatus(s('off', 'Available')), action: 'Connect' },
      { mark: 'GM', title: 'Gmail', sub: 'Email · supplier and customer threads', ...rowStatus(s('off', 'Available')), action: 'Connect' },
      { mark: 'HU', title: 'HubSpot', sub: 'CRM', ...rowStatus(s('off', 'Available')), action: 'Connect' },
      { mark: 'ZE', title: 'Zendesk', sub: 'Support tickets', ...rowStatus(s('off', 'Available')), action: 'Connect' },
    ],
  },
  models: {
    eyebrow: 'Intelligence', primaryCta: 'Add provider',
    lead: 'Choose the model that powers your agents. Shre runs on a local model by default — add a provider key to route to a frontier model, with per-conversation overrides.',
    stats: [{ value: 5, label: 'Providers' }, { value: 1, label: 'Active' }, { value: 'Local', label: 'Default' }],
    rows: [
      { mark: 'SH', title: 'Shre (local)', sub: 'llama3.2 · default · no key needed', ...rowStatus(s('on', 'Active')), action: 'Configure' },
      { mark: 'AN', title: 'Anthropic Claude', sub: 'claude-sonnet-4-6', ...rowStatus(s('off', 'Add key')), action: 'Connect' },
      { mark: 'OA', title: 'OpenAI', sub: 'gpt-4o', ...rowStatus(s('off', 'Add key')), action: 'Connect' },
      { mark: 'GO', title: 'Google Gemini', sub: 'gemini-2.5-flash', ...rowStatus(s('off', 'Add key')), action: 'Connect' },
      { mark: 'OL', title: 'Ollama (local)', sub: 'Self-hosted models', ...rowStatus(s('off', 'Available')), action: 'Connect' },
    ],
  },
  devices: {
    eyebrow: 'Node ecosystem',
    lead: 'Enrolled computers contribute securely through device-scoped identities. Review operating system, versions, last login, heartbeat, and recent activity.',
    stats: [{ value: 0, label: 'Enrolled' }, { value: 0, label: 'Active now' }, { value: 0, label: 'Needs attention' }],
    note: { title: 'No computers enrolled', body: 'Enroll a computer from a store connection and its live device inventory will appear here.' },
  },
  health: {
    eyebrow: 'Observability', primaryCta: 'Run all checks',
    lead: 'Live status of every connected register, app, model, and sync job — with the failing ones surfaced first so nothing quietly breaks.',
    stats: [{ value: 2, label: 'Healthy' }, { value: 1, label: 'Degraded' }, { value: 1, label: 'Down' }],
    rows: [
      { mark: 'RA', title: 'RapidRMS sync', sub: 'Last sync 2 min ago · 5 stores flowing', ...rowStatus(s('on', 'Healthy')), action: 'Details' },
      { mark: 'SH', title: 'Shre model', sub: 'Local model responding normally', ...rowStatus(s('on', 'Healthy')), action: 'Details' },
      { mark: 'VE', title: 'Verifone Commander', sub: 'Credential expiring in 3 days', ...rowStatus(s('warn', 'Degraded')), action: 'Fix' },
      { mark: 'GM', title: 'Gmail connector', sub: 'Not connected', ...rowStatus(s('off', 'Down')), action: 'Connect' },
    ],
  },
  documents: {
    eyebrow: 'Documents',
    lead: 'Store, organize, and share your workspace files — folders, uploads, and secure links.',
  },
  permissions: {
    eyebrow: 'Governance',
    lead: 'Control what each role and agent may read and change — scoped by workspace, connection, store, capability, and action. Write actions are always approval-gated.',
    rows: [
      { mark: 'Ow', title: 'Owner', sub: 'Full access · manage billing, connections, and permissions', ...rowStatus(s('on', 'All scopes')), action: 'Edit' },
      { mark: 'Ad', title: 'Admin', sub: 'Manage stores, apps, skills, and agents', ...rowStatus(s('on', 'Most scopes')), action: 'Edit' },
      { mark: 'Me', title: 'Member', sub: 'Chat and read-only insights', ...rowStatus(s('warn', 'Read only')), action: 'Edit' },
    ],
    note: { title: 'Approval gates active', body: 'Every write action — price changes, reorders, sends — pauses for a human to approve before it runs.' },
  },
  team: {
    eyebrow: 'Administration', primaryCta: 'Invite user',
    lead: 'Invite teammates and assign workspace roles with least-privilege access.',
    stats: [{ value: 1, label: 'Members' }, { value: 3, label: 'Roles' }, { value: 0, label: 'Pending invites' }],
    rows: [
      { mark: 'DR', title: 'Dana Reyes', sub: 'dana@fivepointsmarket.com · Owner', ...rowStatus(s('on', 'Active')), action: 'Manage' },
    ],
  },
  billing: {
    eyebrow: 'Administration', primaryCta: 'Manage plan',
    lead: 'Plan, usage, and invoices for your AROS workspace.',
    stats: [{ value: 'Growth', label: 'Plan' }, { value: '5', label: 'Stores' }, { value: 'Jul 30', label: 'Next invoice' }],
    note: { title: 'You’re on the Growth plan', body: 'Up to 10 stores, unlimited chat, and all agents. Change plans anytime — no interruption to your stores.' },
  },
  usage: {
    eyebrow: 'Administration',
    lead: 'Model spend, calls, and per-agent usage over the current period.',
    stats: [{ value: '12,480', label: 'Calls (30d)' }, { value: '$42.10', label: 'Spend (30d)' }, { value: 'Local', label: 'Top model' }],
    rows: [
      { mark: 'SO', title: 'Store Operations Agent', sub: '6,120 calls · $0.00 (local)', ...rowStatus(s('on', 'Running')), action: 'View' },
      { mark: 'IN', title: 'Inventory Agent', sub: '4,010 calls · $0.00 (local)', ...rowStatus(s('on', 'Running')), action: 'View' },
      { mark: 'CO', title: 'Store concierge', sub: '2,350 calls · $42.10 (frontier)', ...rowStatus(s('on', 'Running')), action: 'View' },
    ],
  },
  notifications: {
    eyebrow: 'Administration', primaryCta: 'Save preferences',
    lead: 'Choose which notifications reach you and on which channel (email, text).',
    stats: [{ value: 5, label: 'Notification types' }, { value: 2, label: 'Channels' }],
  },
  wallet: {
    eyebrow: 'Billing', primaryCta: 'Add credit',
    lead: 'Your prepaid balance for AI usage. Add funds, or turn on auto-recharge.',
  },
  developers: {
    eyebrow: 'Developers', primaryCta: 'Submit a plugin',
    lead: 'Publish an app, connector, or plugin to the AROS Marketplace — submission steps, integration contract, and demo-credential requirements.',
  },
  profile: {
    eyebrow: 'Account', primaryCta: 'Save changes',
    lead: 'Your personal account — display name, sign-in password, and email. Workspace-wide settings live under Settings.',
    form: [{ label: 'Display name', value: 'Dana Reyes' }, { label: 'Email', value: 'dana@fivepointsmarket.com' }],
  },
  settings: {
    eyebrow: 'Administration', primaryCta: 'Save changes',
    lead: 'Workspace name, branding, and account preferences.',
    form: [
      { label: 'Workspace name', value: 'Five Points Market', type: 'text' },
      { label: 'Timezone', value: 'America/New_York', type: 'select', options: ['America/New_York', 'America/Chicago', 'America/Los_Angeles'] },
      { label: 'Default store', value: 'All stores', type: 'select', options: ['All stores', 'Main St', 'Oak Ave', 'Harbor'] },
    ],
    note: { title: 'Security baseline', body: 'OAuth is preferred over API keys. Secrets are sealed in the Shreai vault; permissions are scoped by workspace, connection, store, capability, and action.' },
  },
};

// Connect-a-register wizard. POS scoped to RapidRMS + Verifone Commander only.
// `type` + field `key`s match the real connectors API (POST /api/connectors:
// { type, name, config, secrets }) — see pages/connect/ConnectStorePage + the
// backend rapidrms-api / verifone connectors.
// POS provider catalogue moved to lib/posProviders.ts — single source of
// truth shared with the /connect page (was a drifting duplicate here).
export const STORES_SCOPE = ['Main St', 'Oak Ave', '3rd St Express', 'Harbor', 'Elm St Express'];

export const SECTION_TITLES: Record<SectionKey, string> = {
  chat: 'Concierge', stores: 'Stores', marketplace: 'Marketplace', apps: 'Apps', connectors: 'Connectors', plugins: 'Plugins', skills: 'Skills', agents: 'Agents',
  models: 'Models', devices: 'Computers', permissions: 'Permissions', health: 'Connection Health',
  documents: 'Documents', team: 'Team', billing: 'Billing', usage: 'Usage', settings: 'Settings', notifications: 'Notifications', wallet: 'Wallet', profile: 'Profile', developers: 'Developers', 'edi-invoices': 'EDI Invoices',
};

function rowStatus([status, statusLabel]: [Status, string]) { return { status, statusLabel }; }
