/**
 * Automation rules core: fingerprint canonicalization, create preconditions,
 * confirm card + stateless confirm-flow detection, rule-ref resolution.
 * Mission: docs/missions/aros-automation-rules.md (slice 1a).
 */
import { describe, expect, it } from 'vitest';
import {
  AUTOMATION_CATALOG_EVENT,
  MAX_ENABLED_RULES,
  buildDestinationRef,
  canonicalFingerprint,
  confirmationCard,
  detectConfirmReply,
  duplicateReply,
  evaluateCreatePreconditions,
  extractConfirmPayload,
  insertRowForRule,
  maskDestination,
  prefRowForActiveRule,
  resolveRuleRef,
  sanitizeConfirmedRule,
  type CreateContext,
  type ExistingRule,
  type RuleSpec,
} from '../automation/rules';

const TENANT = '11111111-1111-1111-1111-111111111111';
const USER = '22222222-2222-2222-2222-222222222222';

const voidSmsRule: RuleSpec = {
  tenant_id: TENANT,
  kind: 'event',
  trigger_type: 'transaction_voided',
  scope: 'all-stores',
  channel: 'sms',
  destination_ref: buildDestinationRef('sms', USER),
  cadence: null,
  params: {},
};

function ctx(overrides: Partial<CreateContext> = {}): CreateContext {
  return {
    role: 'owner',
    existingRulesCount: 0,
    existingSameTypeRules: [],
    connectorConnected: true,
    destinationRegistered: true,
    fingerprint: canonicalFingerprint(voidSmsRule),
    stage: 'save',
    ...overrides,
  };
}

describe('canonicalFingerprint', () => {
  it('is stable for the same rule', () => {
    expect(canonicalFingerprint(voidSmsRule)).toBe(canonicalFingerprint({ ...voidSmsRule }));
  });
  it('is order-insensitive over params', () => {
    const a = { ...voidSmsRule, params: { store: 's1', min_amount: 5 } };
    const b = { ...voidSmsRule, params: { min_amount: 5, store: 's1' } };
    expect(canonicalFingerprint(a)).toBe(canonicalFingerprint(b));
  });
  it('same rule from different wording paths hashes identically (null/undefined/default normalization)', () => {
    const sparse: RuleSpec = { tenant_id: TENANT, kind: 'event', trigger_type: 'transaction_voided', channel: 'sms', destination_ref: buildDestinationRef('sms', USER) };
    expect(canonicalFingerprint(sparse)).toBe(canonicalFingerprint(voidSmsRule));
  });
  it('differs by channel, destination, trigger, and tenant', () => {
    expect(canonicalFingerprint({ ...voidSmsRule, channel: 'email' })).not.toBe(canonicalFingerprint(voidSmsRule));
    expect(canonicalFingerprint({ ...voidSmsRule, destination_ref: buildDestinationRef('sms', 'other-user') })).not.toBe(canonicalFingerprint(voidSmsRule));
    expect(canonicalFingerprint({ ...voidSmsRule, tenant_id: '33333333-3333-3333-3333-333333333333' })).not.toBe(canonicalFingerprint(voidSmsRule));
  });
});

describe('evaluateCreatePreconditions', () => {
  const existing: ExistingRule = {
    id: 'r1', fingerprint: canonicalFingerprint(voidSmsRule), status: 'active',
    created_at: '2026-07-20T00:00:00Z', trigger_type: 'transaction_voided', channel: 'sms',
  };

  it('rejects non-owner/admin roles (member, viewer, cashier)', () => {
    for (const role of ['member', 'viewer', 'cashier', '']) {
      expect(evaluateCreatePreconditions(ctx({ role }))).toEqual({ decision: 'reject_role' });
    }
  });
  it('allows owner and admin', () => {
    expect(evaluateCreatePreconditions(ctx({ role: 'owner' }))).toEqual({ decision: 'ok' });
    expect(evaluateCreatePreconditions(ctx({ role: 'admin' }))).toEqual({ decision: 'ok' });
  });
  it('rejects an unregistered destination even for an owner', () => {
    expect(evaluateCreatePreconditions(ctx({ destinationRegistered: false }))).toEqual({ decision: 'reject_destination' });
  });
  it('exact duplicate wins over cap and connector state', () => {
    const verdict = evaluateCreatePreconditions(ctx({
      existingSameTypeRules: [existing], existingRulesCount: MAX_ENABLED_RULES, connectorConnected: false,
    }));
    expect(verdict).toMatchObject({ decision: 'duplicate_exact', existing: { id: 'r1' } });
  });
  it('a disabled rule with the same fingerprint is NOT an exact-dupe block', () => {
    const verdict = evaluateCreatePreconditions(ctx({
      existingSameTypeRules: [{ ...existing, status: 'disabled' }],
    }));
    expect(verdict.decision).toBe('ok');
  });
  it('rejects the 26th enabled rule (cap 25)', () => {
    expect(evaluateCreatePreconditions(ctx({ existingRulesCount: 25 }))).toEqual({ decision: 'reject_cap', cap: 25 });
    expect(evaluateCreatePreconditions(ctx({ existingRulesCount: 24 }))).toEqual({ decision: 'ok' });
  });
  it('propose stage surfaces similar same-type rules (fuzzy dupe)', () => {
    const similar = { ...existing, id: 'r2', fingerprint: 'different' };
    const verdict = evaluateCreatePreconditions(ctx({ stage: 'propose', existingSameTypeRules: [similar] }));
    expect(verdict).toMatchObject({ decision: 'similar_exists' });
  });
  it('propose stage with no conflicts asks for confirmation (never silent-saves)', () => {
    expect(evaluateCreatePreconditions(ctx({ stage: 'propose' }))).toEqual({ decision: 'needs_confirm' });
  });
  it('save stage without a connected connector lands pending_connector', () => {
    expect(evaluateCreatePreconditions(ctx({ connectorConnected: false }))).toEqual({ decision: 'pending_connector' });
  });
});

describe('sanitizeConfirmedRule (tamper defense — re-derive, never trust the payload)', () => {
  it('re-derives destination_ref from the authenticated user, ignoring a tampered value', () => {
    const tampered: RuleSpec = { ...voidSmsRule, destination_ref: 'prefs:sms:99999999-9999-9999-9999-999999999999' };
    const clean = sanitizeConfirmedRule(tampered, { tenantId: TENANT, userId: USER });
    expect(clean?.destination_ref).toBe(buildDestinationRef('sms', USER));
  });
  it('rejects a raw free-text destination smuggled into destination_ref', () => {
    const tampered: RuleSpec = { ...voidSmsRule, destination_ref: '+15551234567' };
    const clean = sanitizeConfirmedRule(tampered, { tenantId: TENANT, userId: USER });
    expect(clean?.destination_ref).toBe(buildDestinationRef('sms', USER)); // re-derived, not the raw number
  });
  it('rejects a foreign tenant payload', () => {
    expect(sanitizeConfirmedRule({ ...voidSmsRule, tenant_id: '33333333-3333-3333-3333-333333333333' }, { tenantId: TENANT, userId: USER })).toBeNull();
  });
  it('rejects a schedule kind (shift/tender have no verified data contract in v1)', () => {
    const schedule = { ...voidSmsRule, kind: 'schedule' as const, trigger_type: undefined, report_type: 'shift_report' };
    expect(sanitizeConfirmedRule(schedule as unknown as RuleSpec, { tenantId: TENANT, userId: USER })).toBeNull();
  });
  it('rejects an unknown/invented trigger_type not in the catalog whitelist', () => {
    expect(sanitizeConfirmedRule({ ...voidSmsRule, trigger_type: 'delete_all_data' }, { tenantId: TENANT, userId: USER })).toBeNull();
  });
  it('strips unexpected params/scope, keeping only the user-chosen trigger + channel', () => {
    const clean = sanitizeConfirmedRule({ ...voidSmsRule, params: { evil: true }, scope: 'somewhere' }, { tenantId: TENANT, userId: USER });
    expect(clean?.params).toEqual({});
    expect(clean?.trigger_type).toBe('transaction_voided');
    expect(clean?.channel).toBe('sms');
  });
});

describe('duplicateReply (reports the real status, never a hardcoded guess)', () => {
  it('states active / pending / suspended distinctly', () => {
    expect(duplicateReply('active', '2026-07-20T00:00:00Z')).toMatch(/active/i);
    expect(duplicateReply('pending_connector')).toMatch(/store connection|waiting/i);
    expect(duplicateReply('suspended')).toMatch(/suspended|paused/i);
  });
  it('does not claim active for a paused rule', () => {
    expect(duplicateReply('pending_connector')).not.toMatch(/it's active/i);
  });
});

describe('insertRowForRule (watermark = activation timestamp, no backlog)', () => {
  const now = '2026-07-22T12:00:00Z';
  it('sets watermark now for an active rule', () => {
    const row = insertRowForRule(voidSmsRule, { status: 'active', userId: USER, fingerprint: 'fp', now });
    expect(row.watermark).toBe(now);
    expect(row.status).toBe('active');
  });
  it('leaves watermark null for pending_connector (1b sweep sets it on activation)', () => {
    const row = insertRowForRule(voidSmsRule, { status: 'pending_connector', userId: USER, fingerprint: 'fp', now });
    expect(row.watermark).toBeNull();
  });
});

describe('prefRowForActiveRule (the rule is the opt-in)', () => {
  const now = '2026-07-22T12:00:00Z';
  it('enables the mapped catalog event for an active rule', () => {
    const row = prefRowForActiveRule(voidSmsRule, { status: 'active', userId: USER, destination: '+15550100', now });
    expect(row).toMatchObject({ event_type: AUTOMATION_CATALOG_EVENT.transaction_voided, channel: 'sms', enabled: true, destination: '+15550100' });
  });
  it('writes no pref row for a pending_connector rule (deferred to activation)', () => {
    expect(prefRowForActiveRule(voidSmsRule, { status: 'pending_connector', userId: USER, destination: null, now })).toBeNull();
  });
  it('maps transaction_voided to the void-alert catalog id', () => {
    expect(AUTOMATION_CATALOG_EVENT.transaction_voided).toBe('void-alert');
  });
});

describe('confirmationCard + stateless confirm detection', () => {
  const card = confirmationCard(voidSmsRule, {
    destinationLabel: 'number ending in 0100',
    connectorConnected: true,
    similar: [],
  });

  it('renders trigger, channel, destination, store scope, and the confirm/cancel instruction', () => {
    expect(card).toContain('a transaction is voided');
    expect(card).toContain('text (SMS)');
    expect(card).toContain('number ending in 0100');
    expect(card).toContain('all connected stores');
    expect(card).toMatch(/confirm/i);
    expect(card).toMatch(/cancel/i);
  });
  it('round-trips the rule through the embedded payload', () => {
    expect(extractConfirmPayload(card)).toEqual(voidSmsRule);
  });
  it('shows the pending-connector callout with the connect deep link when no POS is connected', () => {
    const pendingCard = confirmationCard(voidSmsRule, { destinationLabel: 'x', connectorConnected: false });
    expect(pendingCard).toContain('pending connector');
    expect(pendingCard).toContain('/onboarding');
    expect(pendingCard).toContain('never fires on history');
  });
  it('lists similar rules with the update-or-separate question', () => {
    const similarCard = confirmationCard(voidSmsRule, {
      destinationLabel: 'x', connectorConnected: true,
      similar: [{ index: 1, description: 'text (SMS) when a transaction is voided — active', created_at: '2026-07-20T00:00:00Z' }],
    });
    expect(similarCard).toContain('similar');
    expect(similarCard).toMatch(/update the existing rule or create a separate one/i);
  });

  const history = (finalUser: string) => [
    { role: 'user', content: 'text me when someone voids a transaction' },
    { role: 'assistant', content: card },
    { role: 'user', content: finalUser },
  ];

  it('detects confirm replies', () => {
    for (const answer of ['confirm', 'yes', 'Yes!', 'ok', 'go ahead']) {
      const detected = detectConfirmReply(history(answer));
      expect(detected).toMatchObject({ state: 'confirm' });
      expect((detected as { rule: RuleSpec }).rule).toEqual(voidSmsRule);
    }
  });
  it('detects cancel replies', () => {
    for (const answer of ['cancel', 'no', 'never mind']) {
      expect(detectConfirmReply(history(answer))).toMatchObject({ state: 'cancel' });
    }
  });
  it('classifies anything else as other (card abandoned)', () => {
    expect(detectConfirmReply(history('what were my sales today'))).toMatchObject({ state: 'other' });
  });
  it('returns null when no confirm card is pending', () => {
    expect(detectConfirmReply([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
      { role: 'user', content: 'confirm' },
    ])).toBeNull();
    expect(detectConfirmReply([])).toBeNull();
  });
  it('an intervening assistant turn abandons the card', () => {
    expect(detectConfirmReply([
      { role: 'assistant', content: card },
      { role: 'user', content: 'what were my sales' },
      { role: 'assistant', content: 'your sales were $100' },
      { role: 'user', content: 'confirm' },
    ])).toBeNull();
  });
  it('rejects tampered/garbage payloads', () => {
    expect(extractConfirmPayload('<!--aros-automation-confirm:!!!notbase64-->')).toBeNull();
    expect(extractConfirmPayload(`<!--aros-automation-confirm:${Buffer.from('{"v":1,"rule":{"kind":"nope"}}').toString('base64')}-->`)).toBeNull();
    expect(extractConfirmPayload('no marker here')).toBeNull();
  });
});

describe('resolveRuleRef', () => {
  const rules = [
    { id: 'a', trigger_type: 'transaction_voided' },
    { id: 'b', trigger_type: 'transaction_voided' },
    { id: 'c', trigger_type: null },
  ];
  it('resolves a 1-based index', () => {
    expect(resolveRuleRef(rules, { index: 2 })).toEqual({ rule: rules[1] });
    expect(resolveRuleRef(rules, { index: 9 })).toEqual({ error: 'not_found' });
  });
  it('resolves a unique trigger reference and flags ambiguity', () => {
    expect(resolveRuleRef(rules, { trigger_type: 'transaction_voided' })).toEqual({ error: 'ambiguous' });
    expect(resolveRuleRef([rules[0]], { trigger_type: 'transaction_voided' })).toEqual({ rule: rules[0] });
  });
  it('without a ref: only unambiguous when exactly one rule exists', () => {
    expect(resolveRuleRef([rules[0]], undefined)).toEqual({ rule: rules[0] });
    expect(resolveRuleRef(rules, undefined)).toEqual({ error: 'ambiguous' });
    expect(resolveRuleRef([], undefined)).toEqual({ error: 'not_found' });
  });
});

describe('maskDestination', () => {
  it('never echoes a full phone number', () => {
    expect(maskDestination('sms', '+1 (555) 555-0100')).toBe('number ending in 0100');
    expect(maskDestination('sms', null)).toBe('your registered mobile number');
  });
  it('masks email local parts', () => {
    expect(maskDestination('email', 'nirav@store.com')).toBe('n•••@store.com');
    expect(maskDestination('email', null)).toBe('your account email');
  });
});
