/** Prepaid wallet pure-logic: balance, freeze, auto-recharge trigger, validation. */
import { describe, expect, it } from 'vitest';
import {
  computeBalanceUsd, isFrozen, buildWalletView, shouldAutoRecharge,
  validateTopupUsd, validateAutoRechargeInput, ONBOARDING_GRANT_USD,
} from '../wallet';

const settings = { autoRechargeEnabled: false, autoRechargeThresholdUsd: 10, autoRechargeAmountUsd: 25, hasCard: false };

describe('balance', () => {
  it('is credits minus usage, cent-rounded', () => {
    expect(computeBalanceUsd(50, 12.3456)).toBe(37.65);
    expect(computeBalanceUsd(ONBOARDING_GRANT_USD, 0)).toBe(50);
  });
  it('frozen at or below zero', () => {
    expect(isFrozen(0)).toBe(true);
    expect(isFrozen(-0.004)).toBe(true); // rounds to 0 cents
    expect(isFrozen(0.01)).toBe(false);
  });
  it('view surfaces frozen + rounded parts', () => {
    const v = buildWalletView(50, 50.009, settings);
    expect(v.balanceUsd).toBe(-0.01);
    expect(v.frozen).toBe(true);
  });
});

describe('auto-recharge trigger', () => {
  it('fires only when enabled, carded, and at/under threshold', () => {
    const on = { autoRechargeEnabled: true, autoRechargeThresholdUsd: 10, autoRechargeAmountUsd: 25, hasCard: true };
    expect(shouldAutoRecharge(9.99, on)).toBe(true);
    expect(shouldAutoRecharge(10, on)).toBe(true);
    expect(shouldAutoRecharge(10.01, on)).toBe(false);
    expect(shouldAutoRecharge(5, { ...on, hasCard: false })).toBe(false);
    expect(shouldAutoRecharge(5, { ...on, autoRechargeEnabled: false })).toBe(false);
  });
});

describe('validation', () => {
  it('top-up bounds', () => {
    expect(validateTopupUsd(25)).toEqual({ cents: 2500 });
    expect('error' in validateTopupUsd(1)).toBe(true);
    expect('error' in validateTopupUsd(5000)).toBe(true);
    expect('error' in validateTopupUsd('abc')).toBe(true);
  });
  it('auto-recharge input', () => {
    expect(validateAutoRechargeInput({ enabled: true, thresholdUsd: 10, amountUsd: 25 })).toEqual({ enabled: true, thresholdUsd: 10, amountUsd: 25 });
    expect('error' in validateAutoRechargeInput({ enabled: true, thresholdUsd: 10, amountUsd: 10 })).toBe(true); // amount <= threshold
    expect('error' in validateAutoRechargeInput({ enabled: true, thresholdUsd: 10, amountUsd: 2 })).toBe(true); // below min
    expect(validateAutoRechargeInput({ enabled: false })).toMatchObject({ enabled: false });
  });
});
