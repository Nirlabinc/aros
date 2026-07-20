import { describe, expect, it } from 'vitest';
import {
  demoResult,
  missingOperatorScope,
  operatorToolRoute,
  operatorTools,
  toolsBySurface,
} from '../../apps/mcp-aros/src/tools.js';

// Honesty contract for the mcp-aros operator surface: every advertised tool
// is backed by a real AROS API route in production (no advertised-but-
// not_implemented tools), and descriptions claim only what connected data
// sources can provide.

describe('mcp-aros operator tool surface', () => {
  it('advertises the expected five operator tools', () => {
    expect(operatorTools.map((tool) => tool.name)).toEqual([
      'aros_get_store_summary',
      'aros_get_connector_health',
      'aros_get_inventory_risks',
      'aros_get_exception_summary',
      'aros_draft_action',
    ]);
    expect(toolsBySurface.operator).toBe(operatorTools);
  });

  it('backs EVERY advertised operator tool with a production route (honesty regression)', () => {
    for (const tool of operatorTools) {
      expect(operatorToolRoute(tool.name, {}), `${tool.name} must map to an AROS API route`).not.toBeNull();
    }
  });

  it('returns no route for unknown tools', () => {
    expect(operatorToolRoute('aros_get_everything', {})).toBeNull();
  });

  it('does not overclaim inventory signals (no fast-moving/stale/horizon promises)', () => {
    const tool = operatorTools.find((entry) => entry.name === 'aros_get_inventory_risks')!;
    expect(tool.description.toLowerCase()).toContain('low-stock');
    expect(tool.description.toLowerCase()).not.toContain('fast-moving');
    expect(tool.description.toLowerCase()).not.toContain('stale');
    const properties = (tool.inputSchema as { properties: Record<string, unknown> }).properties;
    expect(Object.keys(properties).sort()).toEqual(['limit', 'storeIds']);
    expect(tool.annotations).toMatchObject({ readOnlyHint: true });
  });

  it('states the exception summary is void-only and names the unsupported types', () => {
    const tool = operatorTools.find((entry) => entry.name === 'aros_get_exception_summary')!;
    expect(tool.description.toLowerCase()).toContain('void');
    expect(tool.description.toLowerCase()).toContain('not available');
    const properties = (tool.inputSchema as { properties: Record<string, unknown> }).properties;
    expect(Object.keys(properties).sort()).toEqual(['endDate', 'startDate', 'storeIds']);
    expect(tool.annotations).toMatchObject({ readOnlyHint: true });
  });
});

describe('operator tool routes', () => {
  it('maps inventory risks to /api/store/inventory-risks with scoped stores + limit', () => {
    const route = operatorToolRoute('aros_get_inventory_risks', { storeIds: ['s1', 's2'], limit: 5 });
    expect(route).toEqual({ path: '/api/store/inventory-risks?storeIds=s1&storeIds=s2&limit=5' });
  });

  it('maps exception summary to /api/store/exceptions with the date range', () => {
    const route = operatorToolRoute('aros_get_exception_summary', {
      storeIds: ['s1'], startDate: '2026-07-14', endDate: '2026-07-20',
    });
    expect(route).toEqual({ path: '/api/store/exceptions?storeIds=s1&startDate=2026-07-14&endDate=2026-07-20' });
  });

  it('keeps the existing store summary and connector health routes unchanged', () => {
    expect(operatorToolRoute('aros_get_store_summary', { storeIds: ['s1'], startDate: '2026-07-19', endDate: '2026-07-20' }))
      .toEqual({ path: '/api/store/summary?storeIds=s1&startDate=2026-07-19&endDate=2026-07-20' });
    expect(operatorToolRoute('aros_get_connector_health', { storeIds: ['s1'] })).toEqual({ path: '/api/connectors' });
  });

  it('keeps draft action as a POST to the human task queue', () => {
    const route = operatorToolRoute('aros_draft_action', {
      storeId: 's1', actionType: 'reorder', title: 'Reorder water', rationale: 'stockout', payload: { sku: 'W24' },
    });
    expect(route?.path).toBe('/api/human/tasks');
    expect(route?.init?.method).toBe('POST');
    expect(JSON.parse(route!.init!.body)).toMatchObject({
      title: 'Reorder water',
      source: 'marketplace-mcp',
      metadata: { actionType: 'reorder', storeId: 's1' },
    });
  });
});

describe('granular scope gate (aros.inventory.read / aros.exceptions.read)', () => {
  it('does not lock out openid-only tokens (current deployments)', () => {
    expect(missingOperatorScope('aros_get_inventory_risks', ['openid'])).toBeNull();
    expect(missingOperatorScope('aros_get_exception_summary', ['openid', 'profile'])).toBeNull();
  });

  it('requires the specific scope once a token carries granular aros.* scopes', () => {
    expect(missingOperatorScope('aros_get_inventory_risks', ['openid', 'aros.store.read'])).toBe('aros.inventory.read');
    expect(missingOperatorScope('aros_get_exception_summary', ['openid', 'aros.store.read'])).toBe('aros.exceptions.read');
    expect(missingOperatorScope('aros_get_inventory_risks', ['openid', 'aros.inventory.read'])).toBeNull();
    expect(missingOperatorScope('aros_get_exception_summary', ['openid', 'aros.exceptions.read'])).toBeNull();
  });

  it('leaves non-gated tools unrestricted', () => {
    expect(missingOperatorScope('aros_get_store_summary', ['openid', 'aros.inventory.read'])).toBeNull();
  });
});

describe('demo mode payloads (unchanged behavior)', () => {
  it('serves synthetic inventory risks clearly labeled as demo data', () => {
    const result = demoResult('aros_get_inventory_risks', { storeIds: ['demo_store_001'] }, 'corr-1', 'operator') as Record<string, unknown>;
    expect(result.source).toBe('synthetic_demo');
    expect(Array.isArray(result.risks)).toBe(true);
    expect((result.risks as Array<Record<string, unknown>>)[0]).toMatchObject({ risk: 'stockout' });
  });

  it('serves synthetic void exceptions clearly labeled as demo data', () => {
    const result = demoResult('aros_get_exception_summary', { storeIds: ['demo_store_001'] }, 'corr-2', 'operator') as Record<string, unknown>;
    expect(result.source).toBe('synthetic_demo');
    expect((result.exceptions as Array<Record<string, unknown>>)[0]).toMatchObject({ type: 'void' });
  });
});
