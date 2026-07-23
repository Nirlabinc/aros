/**
 * Automation sentence parser fixtures — deterministic keyword matching only.
 * Mission: docs/missions/aros-automation-rules.md (slice 1a).
 */
import { describe, expect, it } from 'vitest';
import { parseAutomationSentence } from '../automation/parse';

describe('parseAutomationSentence — void event subscriptions', () => {
  const smsVariants = [
    'text me when someone voids a transaction',
    'Text me whenever a transaction is voided',
    'send me a text if anyone voids a sale',
    'message me every time there is a voided transaction',
    'sms me when a void happens',
  ];
  for (const sentence of smsVariants) {
    it(`parses SMS void alert: "${sentence}"`, () => {
      const parsed = parseAutomationSentence(sentence);
      expect(parsed).toMatchObject({
        action: 'subscribe',
        kind: 'event',
        trigger_type: 'transaction_voided',
        channel: 'sms',
        supported: true,
        confidence: 'high',
      });
      expect(parsed?.destination_free_text).toBeUndefined();
    });
  }

  it('parses email void alert', () => {
    expect(parseAutomationSentence('email me when a transaction is voided')).toMatchObject({
      action: 'subscribe', kind: 'event', trigger_type: 'transaction_voided', channel: 'email', confidence: 'high',
    });
  });

  it('channel-less "alert me" defaults to email with medium confidence', () => {
    expect(parseAutomationSentence('alert me when someone voids a transaction')).toMatchObject({
      action: 'subscribe', kind: 'event', trigger_type: 'transaction_voided', channel: 'email', confidence: 'medium',
    });
    expect(parseAutomationSentence('let me know if a transaction gets voided')).toMatchObject({
      action: 'subscribe', channel: 'email', confidence: 'medium',
    });
  });

  it('surfaces a free-text phone destination for rejection', () => {
    const parsed = parseAutomationSentence('text 555-123-4567 when someone voids a transaction');
    expect(parsed?.action).toBe('subscribe');
    expect(parsed?.destination_free_text).toBe('555-123-4567');
  });

  it('surfaces "text me at <number>" free-text destination', () => {
    const parsed = parseAutomationSentence('text me at +1 (555) 555-0100 when a transaction is voided');
    expect(parsed?.destination_free_text).toBeTruthy();
  });

  it('surfaces a free-text email address for rejection', () => {
    const parsed = parseAutomationSentence('email owner@store.com when someone voids a transaction');
    expect(parsed?.destination_free_text).toBe('owner@store.com');
  });
});

describe('parseAutomationSentence — schedules (recognized, unsupported v1)', () => {
  it('recognizes a nightly shift report as supported:false', () => {
    const parsed = parseAutomationSentence('send me a shift report with tender breakdown every night');
    expect(parsed).toMatchObject({ action: 'subscribe', kind: 'schedule', report_type: 'shift_report', supported: false });
    expect(parsed?.cadence).toMatchObject({ freq: 'daily' });
  });
  it('recognizes a daily tender breakdown with a time', () => {
    const parsed = parseAutomationSentence('email me the tender breakdown daily at 9pm');
    expect(parsed).toMatchObject({ action: 'subscribe', kind: 'schedule', report_type: 'tender_report', supported: false, channel: 'email' });
    expect(parsed?.cadence).toEqual({ freq: 'daily', time: '21:00' });
  });
  it('recognizes weekly cadence', () => {
    const parsed = parseAutomationSentence('send me a shift report every week');
    expect(parsed?.cadence).toMatchObject({ freq: 'weekly' });
    expect(parsed?.supported).toBe(false);
  });
});

describe('parseAutomationSentence — list / disable / delete', () => {
  it('recognizes list intents', () => {
    for (const sentence of ['list my alerts', 'show my automations', 'what alerts do I have', 'list my active rules']) {
      expect(parseAutomationSentence(sentence)).toMatchObject({ action: 'list' });
    }
  });
  it('recognizes disable with a numbered ref', () => {
    expect(parseAutomationSentence('pause rule 2')).toMatchObject({ action: 'disable', rule_ref: { index: 2 } });
    expect(parseAutomationSentence('turn off alert #3')).toMatchObject({ action: 'disable', rule_ref: { index: 3 } });
  });
  it('recognizes disable by trigger keyword', () => {
    expect(parseAutomationSentence('stop texting me about voids')).toMatchObject({
      action: 'disable', rule_ref: { trigger_type: 'transaction_voided' },
    });
    expect(parseAutomationSentence('stop the void alert')).toMatchObject({ action: 'disable' });
  });
  it('recognizes delete', () => {
    expect(parseAutomationSentence('delete rule 1')).toMatchObject({ action: 'delete', rule_ref: { index: 1 } });
    expect(parseAutomationSentence('remove my void alert')).toMatchObject({ action: 'delete' });
  });
});

describe('parseAutomationSentence — non-automation sentences return null', () => {
  const nonMatches = [
    'what were my sales yesterday',
    'show me the top 10 items this week',
    'how many voided transactions did I have yesterday', // read intent, not a subscription
    'void the last transaction', // a write request, not an alert
    'tell me if there were any voids today', // S6: past-tense question, not a forward subscription
    'remove voided transactions from the report', // S6: bare void vocab + "remove" is a data request, not delete-rule
    'hello there',
    'list the invoices from last week',
    '',
  ];
  for (const sentence of nonMatches) {
    it(`returns null for: "${sentence || '(empty)'}"`, () => {
      expect(parseAutomationSentence(sentence)).toBeNull();
    });
  }
});
