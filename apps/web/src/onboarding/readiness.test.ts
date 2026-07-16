import { describe, expect, it } from 'vitest';
import { computeReadiness, isFullyReady, canEnterDashboard, type ReadinessInput } from './readiness';

const empty: ReadinessInput = { model: null, connectors: [], storeSummaryConnected: false, skills: [] };

function byKey(input: ReadinessInput) {
  return Object.fromEntries(computeReadiness(input).map((i) => [i.key, i]));
}

describe('computeReadiness — model', () => {
  it('needs action when no model is chosen', () => {
    expect(byKey(empty).model.state).toBe('action');
  });
  it('is ready with the recommended default', () => {
    expect(byKey({ ...empty, model: { mode: 'recommended' } }).model.state).toBe('ready');
  });
  it('is ready with a BYOM provider and echoes its label', () => {
    const item = byKey({ ...empty, model: { mode: 'byom', label: 'OpenAI · gpt-4o' } }).model;
    expect(item.state).toBe('ready');
    expect(item.detail).toBe('OpenAI · gpt-4o');
  });
});

describe('computeReadiness — store', () => {
  it('needs action with no connectors', () => {
    expect(byKey(empty).store.state).toBe('action');
  });
  it('is pending while a saved connector verifies', () => {
    expect(byKey({ ...empty, connectors: [{ status: 'pending' }] }).store.state).toBe('pending');
  });
  it('is ready when a connector is connected', () => {
    expect(byKey({ ...empty, connectors: [{ status: 'connected' }] }).store.state).toBe('ready');
  });
});

describe('computeReadiness — sync', () => {
  it('is pending (not an error) with no store', () => {
    expect(byKey(empty).sync.state).toBe('pending');
  });
  it('is pending while the first sync runs after a connect', () => {
    expect(byKey({ ...empty, connectors: [{ status: 'connected' }] }).sync.state).toBe('pending');
  });
  it('is ready once live store data is available', () => {
    expect(byKey({ ...empty, connectors: [{ status: 'connected' }], storeSummaryConnected: true }).sync.state).toBe('ready');
  });
});

describe('computeReadiness — skills', () => {
  it('is pending (default skills come after sync) when none exist', () => {
    expect(byKey(empty).skills.state).toBe('pending');
  });
  it('is ready when a skill is active', () => {
    const item = byKey({ ...empty, skills: [{ status: 'active' }] }).skills;
    expect(item.state).toBe('ready');
    expect(item.detail).toContain('1 skill');
  });
  it('is pending while skills provision', () => {
    expect(byKey({ ...empty, skills: [{ status: 'configuring' }] }).skills.state).toBe('pending');
  });
});

describe('gating helpers', () => {
  it('isFullyReady only when every row is ready', () => {
    expect(isFullyReady(computeReadiness(empty))).toBe(false);
    const allReady: ReadinessInput = {
      model: { mode: 'recommended' },
      connectors: [{ status: 'connected' }],
      storeSummaryConnected: true,
      skills: [{ status: 'active' }],
    };
    expect(isFullyReady(computeReadiness(allReady))).toBe(true);
  });

  it('lets the user enter the dashboard as soon as a model is chosen', () => {
    expect(canEnterDashboard(computeReadiness(empty))).toBe(false);
    expect(canEnterDashboard(computeReadiness({ ...empty, model: { mode: 'recommended' } }))).toBe(true);
  });
});
