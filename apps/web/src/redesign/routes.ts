// Pure routing core for the chat-first shell: URL path <-> section mapping.
// Framework-free (no window/React) so it stays unit-testable.
import type { SectionKey } from './shellData';

export type ShellMode = 'home' | 'chat' | 'app';
export type ShellSection = Exclude<SectionKey, 'chat'>;

export const PATH_TO_SECTION: Record<string, ShellSection> = {
  '/stores': 'stores', '/marketplace': 'marketplace', '/apps': 'apps', '/connectors': 'connectors', '/plugins': 'plugins',
  '/skills': 'skills', '/agents': 'agents',
  '/models': 'models', '/computers': 'devices', '/connection-health': 'health', '/settings': 'settings',
  '/permissions': 'permissions', '/documents': 'documents',
  '/edi-invoices': 'edi-invoices',
  '/developers': 'developers', '/submit-plugin': 'developers',
  '/profile': 'profile', '/billing': 'billing', '/costs': 'usage', '/users': 'team',
  // Natural-name aliases — typing /team or /usage previously fell through to
  // Home, which read as "this feature is missing" (validation sweep finding).
  '/team': 'team', '/usage': 'usage',
  '/notifications': 'notifications',
  '/workspace': 'settings', '/channels': 'apps',
};

export const SECTION_TO_PATH: Partial<Record<SectionKey, string>> = {
  stores: '/stores', marketplace: '/marketplace', apps: '/apps', connectors: '/connectors', plugins: '/plugins',
  skills: '/skills', agents: '/agents',
  models: '/models', devices: '/computers', health: '/connection-health', settings: '/settings', profile: '/profile', developers: '/developers',
  billing: '/billing', usage: '/costs', team: '/users', permissions: '/permissions', documents: '/documents',
  notifications: '/notifications',
  'edi-invoices': '/edi-invoices',
};

export function routeState(path: string): { mode: ShellMode; section: ShellSection } {
  if (path === '/dashboard' || path === '/human' || path === '/auth') return { mode: 'home', section: 'stores' };
  if (path === '/chat') return { mode: 'chat', section: 'stores' };
  const match = Object.entries(PATH_TO_SECTION).find(([prefix]) => path.startsWith(prefix));
  return { mode: match ? 'app' : 'home', section: match?.[1] ?? 'stores' };
}
