/**
 * Automation sentinel execution core (slice 1b): void-diff, activation sweep,
 * volume caps, coalescing, and message shaping. All pure — plain asserts, no
 * DB, no clock. Mission: docs/missions/aros-automation-rules.md.
 */
import { describe, expect, it } from 'vitest';
import {
  AUTOMATION_MAX_FIRES_PER_HOUR,
  AUTOMATION_MAX_FIRES_PER_TENANT_DAY,
  applyPerRuleRateLimit,
  automationFireClaim,
  coalesceFires,
  decideActivation,
  fireDedupeKey,
  isAfterWatermark,
  isBusinessDayAfterWatermark,
  newVoidsForRule,
  ruleSuspendedMessage,
  tenantDailyCapReached,
  testFireMessage,
  voidAlertMessage,
  voidIsAfterWatermark,
  type InvoiceLike,
} from '../automation/rules';

const WM = '2026-07-22T12:00:00Z'; // activation watermark

function inv(over: Partial<InvoiceLike> = {}): InvoiceLike {
  return { invoiceNo: 'INV-1', recordId: 'R1', businessDate: '2026-07-22', timestamp: '2026-07-22T13:00:00Z', amount: 12.5, isVoid: true, ...over };
}

describe('decideActivation (idempotent, path-independent sweep)', () => {
  it('activates a pending rule once its connector is connected', () => {
    expect(decideActivation('pending_connector', true)).toBe('activate');
  });
  it('leaves a pending rule pending while no connector', () => {
    expect(decideActivation('pending_connector', false)).toBe('none');
  });
  it('deactivates an active rule when its connector disappears (visible flip, no silent no-op)', () => {
    expect(decideActivation('active', false)).toBe('deactivate');
  });
  it('is a no-op for an already-correct active/connected rule', () => {
    expect(decideActivation('active', true)).toBe('none');
  });
  it('never touches suspended or disabled rules', () => {
    expect(decideActivation('suspended', true)).toBe('none');
    expect(decideActivation('suspended', false)).toBe('none');
    expect(decideActivation('disabled', true)).toBe('none');
  });
});

describe('isAfterWatermark (backlog guard, fail-closed)', () => {
  it('true only strictly after the watermark', () => {
    expect(isAfterWatermark('2026-07-22T12:00:01Z', WM)).toBe(true);
    expect(isAfterWatermark('2026-07-22T12:00:00Z', WM)).toBe(false); // equal = not after
    expect(isAfterWatermark('2026-07-22T11:59:59Z', WM)).toBe(false);
  });
  it('fails closed on missing/unparseable inputs', () => {
    expect(isAfterWatermark('2026-07-22T13:00:00Z', null)).toBe(false); // no watermark = not activated
    expect(isAfterWatermark(null, WM)).toBe(false);
    expect(isAfterWatermark('not-a-date', WM)).toBe(false);
  });
});

describe('isBusinessDayAfterWatermark (fail-closed calendar-day guard, M1)', () => {
  it('true only for a strictly later calendar day', () => {
    expect(isBusinessDayAfterWatermark('2026-07-23', WM)).toBe(true);
    expect(isBusinessDayAfterWatermark('2026-07-22', WM)).toBe(false); // same day as activation = suppress
    expect(isBusinessDayAfterWatermark('2026-07-21', WM)).toBe(false);
  });
  it('fails closed on missing/garbage inputs', () => {
    expect(isBusinessDayAfterWatermark(null, WM)).toBe(false);
    expect(isBusinessDayAfterWatermark('2026-07-23', null)).toBe(false);
    expect(isBusinessDayAfterWatermark('not-a-date', WM)).toBe(false);
  });
});

describe('voidIsAfterWatermark (timestamp precise, else fail-closed day)', () => {
  it('uses the timestamp when present', () => {
    expect(voidIsAfterWatermark({ timestamp: '2026-07-22T12:00:01Z', businessDate: '2026-07-22' }, WM)).toBe(true);
    expect(voidIsAfterWatermark({ timestamp: '2026-07-22T11:59:59Z', businessDate: '2026-07-23' }, WM)).toBe(false);
  });
  it('falls back to the calendar-day rule when there is no timestamp', () => {
    expect(voidIsAfterWatermark({ timestamp: null, businessDate: '2026-07-23' }, WM)).toBe(true);
    expect(voidIsAfterWatermark({ timestamp: null, businessDate: '2026-07-22' }, WM)).toBe(false); // activation-day hole closed
  });
});

describe('newVoidsForRule (void-diff)', () => {
  const base = { watermark: WM, alreadyFired: new Set<string>(), channel: 'sms', destination: '+15550100' };

  it('a new voided invoice after the watermark fires once', () => {
    const out = newVoidsForRule([inv()], base);
    expect(out).toHaveLength(1);
    expect(out[0].invoiceNo).toBe('INV-1');
  });
  it('a non-void invoice never fires', () => {
    expect(newVoidsForRule([inv({ isVoid: false })], base)).toHaveLength(0);
  });
  it('a pre-watermark (backlog) void never fires', () => {
    expect(newVoidsForRule([inv({ timestamp: '2026-07-22T09:00:00Z' })], base)).toHaveLength(0);
  });
  it('a void with only a pre-watermark business date (no timestamp) never fires', () => {
    expect(newVoidsForRule([inv({ timestamp: null, businessDate: '2026-07-21' })], base)).toHaveLength(0);
  });
  it('M1: a timestamp-less void on the ACTIVATION DAY never fires (cannot prove it post-dates activation)', () => {
    // watermark = 2026-07-22T12:00:00Z; a void dated the same calendar day with
    // no per-row timestamp must be SUPPRESSED, not stamped end-of-day.
    expect(newVoidsForRule([inv({ timestamp: null, businessDate: '2026-07-22' })], base)).toHaveLength(0);
  });
  it('M1: a timestamp-less void on the day AFTER activation does fire', () => {
    expect(newVoidsForRule([inv({ timestamp: null, businessDate: '2026-07-23' })], base)).toHaveLength(1);
  });
  it('an already-fired void does not re-fire', () => {
    const alreadyFired = new Set<string>([fireDedupeKey('INV-1', 'sms', '+15550100')]);
    expect(newVoidsForRule([inv()], { ...base, alreadyFired })).toHaveLength(0);
  });
  it('no watermark (rule not activated) never fires, even on a fresh void', () => {
    expect(newVoidsForRule([inv()], { ...base, watermark: null })).toHaveLength(0);
  });
  it('falls back to recordId when invoiceNo is absent', () => {
    const out = newVoidsForRule([inv({ invoiceNo: null })], base);
    expect(out).toHaveLength(1);
    expect(out[0].invoiceNo).toBe('R1');
  });
});

describe('coalesceFires (one message per invoice/channel/destination)', () => {
  const mk = (invoiceNo: string, channel: string, destination: string | null, ruleId: string) => ({ invoiceNo, channel, destination, ruleId });
  it('collapses two overlapping rules hitting the same void into one fire', () => {
    const out = coalesceFires([mk('INV-1', 'sms', '+15550100', 'ruleA'), mk('INV-1', 'sms', '+15550100', 'ruleB')]);
    expect(out).toHaveLength(1);
    expect(out[0].ruleId).toBe('ruleA'); // first wins
  });
  it('keeps distinct channels and destinations separate', () => {
    const out = coalesceFires([
      mk('INV-1', 'sms', '+15550100', 'a'),
      mk('INV-1', 'email', 'o@s.com', 'b'),
      mk('INV-2', 'sms', '+15550100', 'c'),
    ]);
    expect(out).toHaveLength(3);
  });
});

describe('automationFireClaim (H1/H2 — claim key MUST equal the dedupe key)', () => {
  it('maps the candidate onto the ledger unique columns', () => {
    const claim = automationFireClaim('t1', { rule_id: 'r1', invoiceNo: 'INV-1', channel: 'sms', destination: '+15550100' });
    expect(claim).toEqual({ tenant_id: 't1', rule_id: 'r1', invoice_no: 'INV-1', channel: 'sms', destination: '+15550100' });
  });
  it('its key columns reconstruct exactly the coalesce/dedupe key', () => {
    const claim = automationFireClaim('t1', { invoiceNo: 'INV-9', channel: 'email', destination: 'o@s.com' });
    // The DB UNIQUE(tenant_id, invoice_no, channel, destination) is the send
    // authority; the same tuple keys coalesceFires + newVoidsForRule dedupe.
    expect(fireDedupeKey(claim.invoice_no, claim.channel, claim.destination)).toBe(fireDedupeKey('INV-9', 'email', 'o@s.com'));
    expect(claim.rule_id).toBeNull();
  });
});

describe('applyPerRuleRateLimit (hourly cap → suspend on the 6th)', () => {
  it('allows the first MAX fires, suspends the next', () => {
    let window = { firesInWindow: 0, windowStartedAt: null as string | null };
    const t0 = Date.parse('2026-07-22T12:00:00Z');
    for (let i = 1; i <= AUTOMATION_MAX_FIRES_PER_HOUR; i++) {
      const now = new Date(t0 + i * 1000).toISOString();
      const r = applyPerRuleRateLimit(window, now);
      expect(r.allowed).toBe(true);
      expect(r.suspend).toBe(false);
      window = { firesInWindow: r.nextFiresInWindow, windowStartedAt: r.nextWindowStartedAt };
    }
    expect(window.firesInWindow).toBe(AUTOMATION_MAX_FIRES_PER_HOUR);
    const sixth = applyPerRuleRateLimit(window, new Date(t0 + 6000).toISOString());
    expect(sixth.allowed).toBe(false);
    expect(sixth.suspend).toBe(true);
  });
  it('resets the window after an hour so a later fire is allowed again', () => {
    const window = { firesInWindow: AUTOMATION_MAX_FIRES_PER_HOUR, windowStartedAt: '2026-07-22T12:00:00Z' };
    const r = applyPerRuleRateLimit(window, '2026-07-22T13:30:00Z'); // >1h later
    expect(r.allowed).toBe(true);
    expect(r.nextFiresInWindow).toBe(1);
    expect(r.nextWindowStartedAt).toBe('2026-07-22T13:30:00Z');
  });
  it('starts a fresh window on the first ever fire', () => {
    const r = applyPerRuleRateLimit({ firesInWindow: 0, windowStartedAt: null }, WM);
    expect(r.allowed).toBe(true);
    expect(r.nextFiresInWindow).toBe(1);
    expect(r.nextWindowStartedAt).toBe(WM);
  });
});

describe('tenantDailyCapReached (per-tenant 50/day stop)', () => {
  it('stops only at/after the cap', () => {
    expect(tenantDailyCapReached(AUTOMATION_MAX_FIRES_PER_TENANT_DAY - 1)).toBe(false);
    expect(tenantDailyCapReached(AUTOMATION_MAX_FIRES_PER_TENANT_DAY)).toBe(true);
    expect(tenantDailyCapReached(AUTOMATION_MAX_FIRES_PER_TENANT_DAY + 5)).toBe(true);
  });
});

describe('voidAlertMessage', () => {
  it('renders a concrete message with store, amount, time, invoice', () => {
    const msg = voidAlertMessage('Main St Store', { invoiceNo: 'INV-9', amount: 42.75, timestamp: '2026-07-22T13:00:00Z', businessDate: '2026-07-22' });
    expect(msg.text).toContain('Main St Store');
    expect(msg.text).toContain('$42.75');
    expect(msg.text).toContain('INV-9');
    expect(msg.subject).toContain('Voided transaction');
  });
  it('is honest when the amount is missing (never prints $0.00)', () => {
    const msg = voidAlertMessage('Store', { invoiceNo: 'INV-9', amount: null, timestamp: null, businessDate: '2026-07-22' });
    expect(msg.text).not.toContain('$0.00');
    expect(msg.text).toContain('unlisted amount');
  });
});

describe('meta messages', () => {
  it('suspend notice names the fire limit', () => {
    expect(ruleSuspendedMessage('Store').text).toContain(String(AUTOMATION_MAX_FIRES_PER_HOUR));
  });
  it('test-fire is clearly labeled a test and notes it is off-limits', () => {
    const msg = testFireMessage('Store', 'sms');
    expect(msg.subject).toMatch(/test/i);
    expect(msg.text).toMatch(/test/i);
    expect(msg.text).toMatch(/don't count/i);
  });
});
