/**
 * Prepaid wallet — pure logic (no I/O), unit-testable.
 *
 * Balance is COMPUTED: credits (grants + top-ups) minus metered usage. The
 * meter is the usage source of truth, so the balance can never drift.
 */

export const ONBOARDING_GRANT_USD = 50;
/** Top-up amounts offered in the UI (dollars). */
export const TOPUP_PRESETS_USD = [10, 25, 50, 100] as const;
const MIN_TOPUP_USD = 5;
const MAX_TOPUP_USD = 1000;

export interface WalletSettings {
  autoRechargeEnabled: boolean;
  autoRechargeThresholdUsd: number;
  autoRechargeAmountUsd: number;
  hasCard: boolean;
}

export interface WalletView {
  balanceUsd: number;
  creditsUsd: number;
  usageUsd: number;
  frozen: boolean;
  autoRecharge: WalletSettings;
}

/** Round to whole cents so a computed balance never shows sub-cent noise. */
export function toCents(usd: number): number {
  return Math.round(usd * 100);
}

export function computeBalanceUsd(creditsUsd: number, usageUsd: number): number {
  return toCents(creditsUsd - usageUsd) / 100;
}

/** A workspace is frozen (out of funds) when its balance is at or below zero.
 * BYOK/self-hosted usage never costs, so a pure-BYOK workspace never freezes. */
export function isFrozen(balanceUsd: number): boolean {
  return toCents(balanceUsd) <= 0;
}

export function buildWalletView(
  creditsUsd: number,
  usageUsd: number,
  settings: WalletSettings,
): WalletView {
  const balanceUsd = computeBalanceUsd(creditsUsd, usageUsd);
  return {
    balanceUsd,
    creditsUsd: toCents(creditsUsd) / 100,
    usageUsd: toCents(usageUsd) / 100,
    frozen: isFrozen(balanceUsd),
    autoRecharge: settings,
  };
}

/** Should the auto-recharge job charge this workspace now? Requires the
 * feature on, a saved card, and the balance at/under the threshold. */
export function shouldAutoRecharge(balanceUsd: number, settings: WalletSettings): boolean {
  return (
    settings.autoRechargeEnabled &&
    settings.hasCard &&
    settings.autoRechargeAmountUsd > 0 &&
    toCents(balanceUsd) <= toCents(settings.autoRechargeThresholdUsd)
  );
}

/** Validate a requested top-up amount (dollars). Returns cents or an error. */
export function validateTopupUsd(raw: unknown): { cents: number } | { error: string } {
  const usd = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(usd)) return { error: 'Amount must be a number' };
  if (usd < MIN_TOPUP_USD) return { error: `Minimum top-up is $${MIN_TOPUP_USD}` };
  if (usd > MAX_TOPUP_USD) return { error: `Maximum top-up is $${MAX_TOPUP_USD}` };
  return { cents: toCents(usd) };
}

/** Validate auto-recharge settings from a client request. */
export function validateAutoRechargeInput(body: unknown):
  | { enabled: boolean; thresholdUsd: number; amountUsd: number }
  | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'Invalid JSON' };
  const b = body as Record<string, unknown>;
  const enabled = b.enabled === true;
  const thresholdUsd = Number(b.thresholdUsd);
  const amountUsd = Number(b.amountUsd);
  if (enabled) {
    if (!Number.isFinite(thresholdUsd) || thresholdUsd < 0) return { error: 'Threshold must be $0 or more' };
    if (!Number.isFinite(amountUsd) || amountUsd < MIN_TOPUP_USD) return { error: `Recharge amount must be at least $${MIN_TOPUP_USD}` };
    if (amountUsd > MAX_TOPUP_USD) return { error: `Recharge amount cannot exceed $${MAX_TOPUP_USD}` };
    if (amountUsd <= thresholdUsd) return { error: 'Recharge amount should be more than the threshold' };
  }
  return { enabled, thresholdUsd: Number.isFinite(thresholdUsd) ? thresholdUsd : 10, amountUsd: Number.isFinite(amountUsd) ? amountUsd : 25 };
}
