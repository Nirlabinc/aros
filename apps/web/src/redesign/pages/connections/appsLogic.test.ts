import { describe, it, expect } from 'vitest';
import { activeApps } from './appsLogic';
import type { AppGrant, PlatformApp } from './api';

const app = (id: string, name: string, description = ''): PlatformApp => ({ id, name, description });
const grant = (app_key: string, status = 'active'): AppGrant => ({ app_key, status });

const CATALOG = [
  app('storepulse', 'StorePulse', 'Store intelligence'),
  app('documents', 'Documents', 'Workspace document storage'),
  app('edi-invoices', 'EDI Invoices', 'Supplier EDI invoices'),
  app('centrix', 'Centrix', 'CRM'),
];

describe('activeApps', () => {
  it('shows only apps with an active grant', () => {
    const result = activeApps(CATALOG, [grant('documents'), grant('centrix', 'disabled')], '');
    expect(result.map(a => a.id)).toEqual(['documents']);
  });

  it('sorts alphabetically by name, case-insensitive', () => {
    const grants = CATALOG.map(a => grant(a.id));
    const result = activeApps(CATALOG, grants, '');
    expect(result.map(a => a.name)).toEqual(['Centrix', 'Documents', 'EDI Invoices', 'StorePulse']);
  });

  it('filters by search across name and description', () => {
    const grants = CATALOG.map(a => grant(a.id));
    expect(activeApps(CATALOG, grants, 'invoice').map(a => a.id)).toEqual(['edi-invoices']);
    expect(activeApps(CATALOG, grants, 'STORE').map(a => a.id)).toEqual(['storepulse']);
    expect(activeApps(CATALOG, grants, '  ').map(a => a.id)).toHaveLength(4);
  });

  it('returns empty when nothing is installed', () => {
    expect(activeApps(CATALOG, [], '')).toEqual([]);
  });
});
