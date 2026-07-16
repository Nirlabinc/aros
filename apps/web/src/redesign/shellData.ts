// Demo data for the chat-first redesign preview. Mirrors the Claude Design
// export (Five Points Market, RapidRMS connected, 5 stores). Section content is
// placeholder until wired to real surfaces (Concierge → router /v1/chat;
// Skills/Agents → CapabilityCatalog; Stores/Apps → ConnectionsHub).

export type SectionKey =
  | 'chat' | 'stores' | 'apps' | 'skills' | 'agents'
  | 'models' | 'permissions' | 'health' | 'team' | 'billing' | 'usage' | 'settings';

export interface NavItem { key: SectionKey; label: string; glyph: string; count?: number; }

export const PRIMARY_NAV: NavItem[] = [
  { key: 'chat', label: 'Chat', glyph: 'C' },
  { key: 'stores', label: 'Stores', glyph: 'St' },
  { key: 'apps', label: 'Apps', glyph: 'Ap' },
  { key: 'skills', label: 'Skills', glyph: 'Sk', count: 6 },
  { key: 'agents', label: 'Agents', glyph: 'Ag', count: 4 },
  { key: 'models', label: 'Models', glyph: 'M' },
  { key: 'permissions', label: 'Permissions', glyph: 'P' },
  { key: 'health', label: 'Connection Health', glyph: 'H' },
];

export const WORKSPACE_NAV: NavItem[] = [
  { key: 'team', label: 'Team', glyph: 'Tm' },
  { key: 'billing', label: 'Billing', glyph: 'Bi' },
  { key: 'usage', label: 'Usage', glyph: 'Us' },
  { key: 'settings', label: 'Settings', glyph: 'Se' },
];

export const HEALTH = { healthy: 2, degraded: 1, down: 1 };

export const USER = { name: 'Dana Reyes', role: 'Owner', workspace: 'Five Points', initials: 'DR' };

export const ROLES = ['Owner', 'Admin', 'Member'] as const;

export interface ChatMsg { from: 'shre' | 'me'; text: string; meta?: string; }

export const CONCIERGE_SEED: ChatMsg[] = [
  {
    from: 'shre',
    text: 'I’m Shre — your store concierge. Ask me anything, like “How were sales yesterday?” or “Which SKUs are running low?” You can connect a register whenever you’re ready. I’ll never block the chat on setup.',
    meta: 'Shre · Local',
  },
  {
    from: 'shre',
    text: 'RapidRMS is connected — I can see all 5 stores and live sales are flowing. Ask me “How were sales yesterday?” whenever you’re ready.',
    meta: 'Shre · Local',
  },
];

export const SUGGESTIONS = [
  'How were sales yesterday?',
  'Which SKUs are low?',
  'Raise carton prices 3% at all stores',
];

export interface CapabilityCard {
  icon: string; title: string; desc: string; on: boolean; tag: string;
}

export const SKILLS: CapabilityCard[] = [
  { icon: '📊', title: 'Sales digest', desc: 'Daily sales, top movers, and anomalies across every store, pushed each morning.', on: true, tag: 'active' },
  { icon: '📦', title: 'Low-stock watch', desc: 'Flags SKUs below reorder point and drafts a purchase order for your approval.', on: true, tag: 'active' },
  { icon: '🏷️', title: 'Price change', desc: 'Applies price updates across selected stores — always behind an approval gate.', on: true, tag: 'active' },
  { icon: '🧾', title: 'Invoice extract', desc: 'Reads supplier invoices and reconciles them against received inventory.', on: false, tag: 'available' },
  { icon: '📈', title: 'Basket insights', desc: 'Surfaces attach-rate and basket-building opportunities from transaction data.', on: false, tag: 'available' },
  { icon: '🗓️', title: 'Labor planner', desc: 'Suggests shift coverage from sales patterns and flags overtime risk.', on: false, tag: 'available' },
];

export const AGENTS: CapabilityCard[] = [
  { icon: '🛒', title: 'Store concierge', desc: 'The chat you’re talking to — answers questions and runs approved actions across stores.', on: true, tag: 'running' },
  { icon: '🔁', title: 'Replenishment agent', desc: 'Monitors stock and proposes reorders overnight; hands off to you for sign-off.', on: true, tag: 'running' },
  { icon: '💬', title: 'Support agent', desc: 'Answers customer questions on hours, products, and returns from your data.', on: true, tag: 'running' },
  { icon: '🔎', title: 'Pricing analyst', desc: 'Watches margins and competitor moves, drafts price recommendations.', on: false, tag: 'paused' },
];

export const SECTION_TITLES: Record<SectionKey, string> = {
  chat: 'Concierge', stores: 'Stores', apps: 'Apps', skills: 'Skills', agents: 'Agents',
  models: 'Models', permissions: 'Permissions', health: 'Connection Health',
  team: 'Team', billing: 'Billing', usage: 'Usage', settings: 'Settings',
};
