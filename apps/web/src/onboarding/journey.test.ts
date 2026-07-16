import { describe, expect, it } from 'vitest';
import {
  resolveAuthenticatedLanding,
  resolveJourneyStep,
  hasStartedJourney,
  nextProgressStep,
  PROGRESS_START,
  PROGRESS_MODEL,
  PROGRESS_CONNECT,
  PROGRESS_READINESS,
} from './journey';

const base = {
  loading: false,
  hasSession: true,
  onboardingCompleted: false,
  membershipError: false,
  progressStep: null as number | null,
};

describe('resolveAuthenticatedLanding', () => {
  it('waits (null) while auth is still loading', () => {
    expect(resolveAuthenticatedLanding({ ...base, loading: true })).toBeNull();
  });

  it('sends unauthenticated sessions to login', () => {
    expect(resolveAuthenticatedLanding({ ...base, hasSession: false })).toBe('/login');
  });

  it('sends an onboarded workspace to the dashboard even with empty local state', () => {
    // Simulates a new device: no progressStep cached, but the backend tenant
    // flag says onboarding is complete.
    expect(resolveAuthenticatedLanding({ ...base, onboardingCompleted: true, progressStep: null }))
      .toBe('/dashboard');
  });

  it('does not restart onboarding when the membership lookup fails', () => {
    expect(resolveAuthenticatedLanding({ ...base, membershipError: true })).toBe('/dashboard');
  });

  it('sends a genuinely new workspace to /start', () => {
    expect(resolveAuthenticatedLanding({ ...base, progressStep: PROGRESS_START })).toBe('/start');
    expect(resolveAuthenticatedLanding({ ...base, progressStep: null })).toBe('/start');
  });

  it('resumes a mid-journey workspace inside the setup flow', () => {
    expect(resolveAuthenticatedLanding({ ...base, progressStep: PROGRESS_MODEL })).toBe('/onboarding');
    expect(resolveAuthenticatedLanding({ ...base, progressStep: PROGRESS_CONNECT })).toBe('/onboarding');
  });

  it('prioritises the completed flag over any recorded progress step', () => {
    expect(resolveAuthenticatedLanding({ ...base, onboardingCompleted: true, progressStep: PROGRESS_MODEL }))
      .toBe('/dashboard');
  });
});

describe('hasStartedJourney', () => {
  it('is false for brand-new and unknown progress', () => {
    expect(hasStartedJourney(null)).toBe(false);
    expect(hasStartedJourney(PROGRESS_START)).toBe(false);
    expect(hasStartedJourney(0)).toBe(false);
  });
  it('is true once past the start step', () => {
    expect(hasStartedJourney(PROGRESS_MODEL)).toBe(true);
    expect(hasStartedJourney(PROGRESS_READINESS)).toBe(true);
  });
});

describe('resolveJourneyStep', () => {
  const noSignals = { modelChosen: false, storeConnected: false };

  it('defaults to the model step', () => {
    expect(resolveJourneyStep(PROGRESS_START, noSignals)).toBe('model');
    expect(resolveJourneyStep(null, noSignals)).toBe('model');
  });

  it('advances to connect once a model is chosen', () => {
    expect(resolveJourneyStep(PROGRESS_START, { modelChosen: true, storeConnected: false })).toBe('connect');
  });

  it('respects the persisted connect step even without a live model signal', () => {
    expect(resolveJourneyStep(PROGRESS_CONNECT, noSignals)).toBe('connect');
  });

  it('jumps to readiness when a store is connected', () => {
    expect(resolveJourneyStep(PROGRESS_MODEL, { modelChosen: true, storeConnected: true })).toBe('readiness');
  });

  it('respects the persisted readiness step', () => {
    expect(resolveJourneyStep(PROGRESS_READINESS, noSignals)).toBe('readiness');
  });
});

describe('nextProgressStep', () => {
  it('maps each step to the one that follows it', () => {
    expect(nextProgressStep('model')).toBe(PROGRESS_CONNECT);
    expect(nextProgressStep('connect')).toBe(PROGRESS_READINESS);
    expect(nextProgressStep('readiness')).toBe(PROGRESS_READINESS);
  });
});
