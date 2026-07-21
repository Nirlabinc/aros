// Pure list logic for the Active apps page: which apps show, in what order.
// Framework-free so it stays unit-testable.
import type { AppGrant, PlatformApp } from './api';

/** Active (installed) apps only, filtered by search, always A→Z by name. */
export function activeApps(apps: PlatformApp[], grants: AppGrant[], query: string): PlatformApp[] {
  const active = new Set(grants.filter(g => g.status === 'active').map(g => g.app_key));
  const q = query.trim().toLowerCase();
  return apps
    .filter(app => active.has(app.id))
    .filter(app => !q || `${app.name} ${app.description || ''}`.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}
