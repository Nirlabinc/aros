import { describe, it, expect } from 'vitest';
import { routeState, PATH_TO_SECTION, SECTION_TO_PATH } from './routes';

describe('shell route core', () => {
  it('maps home and chat modes', () => {
    expect(routeState('/dashboard')).toEqual({ mode: 'home', section: 'stores' });
    expect(routeState('/human').mode).toBe('home');
    expect(routeState('/chat').mode).toBe('chat');
  });

  it('gives Marketplace, Connectors, and Plugins their own URLs', () => {
    expect(routeState('/marketplace')).toEqual({ mode: 'app', section: 'marketplace' });
    expect(routeState('/connectors')).toEqual({ mode: 'app', section: 'connectors' });
    expect(routeState('/plugins')).toEqual({ mode: 'app', section: 'plugins' });
    expect(SECTION_TO_PATH.marketplace).toBe('/marketplace');
    expect(SECTION_TO_PATH.connectors).toBe('/connectors');
    expect(SECTION_TO_PATH.plugins).toBe('/plugins');
  });

  it('routes in-shell marketplace apps', () => {
    expect(routeState('/documents')).toEqual({ mode: 'app', section: 'documents' });
    expect(routeState('/edi-invoices')).toEqual({ mode: 'app', section: 'edi-invoices' });
  });

  it('does not let /connectors shadow /connection-health (prefix matching)', () => {
    expect(routeState('/connection-health').section).toBe('health');
  });

  it('keeps legacy aliases', () => {
    expect(routeState('/channels').section).toBe('apps');
    expect(routeState('/profile').section).toBe('profile');
    expect(routeState('/costs').section).toBe('usage');
  });

  it('supports natural-name aliases from the validation sweep', () => {
    expect(routeState('/team').section).toBe('team');
    expect(routeState('/usage').section).toBe('usage');
  });

  it('falls back to home for unknown paths', () => {
    expect(routeState('/definitely-not-a-page')).toEqual({ mode: 'home', section: 'stores' });
  });

  it('every navigable section round-trips through its path', () => {
    for (const [section, path] of Object.entries(SECTION_TO_PATH)) {
      expect(PATH_TO_SECTION[path!]).toBeDefined();
      expect(routeState(path!).section).toBe(PATH_TO_SECTION[path!]);
      void section;
    }
  });
});
