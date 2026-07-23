/**
 * Automation sentence parser — pure functional core (no I/O).
 *
 * Deterministic keyword matching that turns a chat sentence into a declarative
 * automation intent, or null when the sentence is not an automation request
 * (null → the message falls through to the normal router path).
 *
 * v1 vocabulary (mission: docs/missions/aros-automation-rules.md):
 * - event triggers: transaction_voided only.
 * - schedules: shift/tender reports are RECOGNIZED but returned with
 *   supported:false — no verified RapidRMS data contract exists for them yet
 *   (honesty rule: no verified contract → no numeric claims, no rule).
 * - management: list / disable(pause,stop) / delete of existing rules.
 *
 * Free-text destinations ("text 555-1234 …") are surfaced via
 * destination_free_text so the shell can REJECT them and route the user to the
 * notification-preferences flow — chat never mints a new destination.
 */

export type AutomationAction = 'subscribe' | 'list' | 'disable' | 'delete';
export type AutomationChannel = 'email' | 'sms';

export interface AutomationCadence {
  freq: 'daily' | 'weekly';
  time?: string; // HH:mm (24h)
  tz?: string;
}

export interface RuleRef {
  /** 1-based position in the tenant's rule list (created_at asc). */
  index?: number;
  /** Trigger keyword reference ("the void alert"). */
  trigger_type?: string;
}

export interface ParsedAutomation {
  action: AutomationAction;
  kind?: 'event' | 'schedule';
  trigger_type?: string;
  report_type?: string;
  channel?: AutomationChannel;
  cadence?: AutomationCadence;
  /** False = recognized request with no verified data contract yet (v1: shift/tender schedules). */
  supported?: boolean;
  /** Free-text phone/email typed directly in chat — must be rejected by the shell. */
  destination_free_text?: string;
  /** For disable/delete: which existing rule the user referenced. */
  rule_ref?: RuleRef;
  confidence: 'high' | 'medium';
}

const VOID_RE = /\bvoid(?:s|ed|ing)?\b/;
// Past-tense markers = the user is asking ABOUT history, not subscribing to
// the future ("tell me if there were any voids today" is a read, not a rule).
const PAST_TENSE_RE = /\b(were|was|did|had|has been|yesterday|last\s+(week|night|month|year))\b/;
const RULE_NOUN_RE = /\b(alerts?|automations?|rules?|subscriptions?|notifications?|reminders?)\b/;
const EMAIL_ADDR_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
// 7+ digits with optional separators — "text 555-0100" / "+1 (555) 555-0100".
const PHONE_RE = /(\+?\d[\d().\s-]{5,}\d)\b/;

function normalize(text: string): string {
  return String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function digitsIn(value: string): number {
  return (value.match(/\d/g) || []).length;
}

function parseRuleRef(text: string): RuleRef | undefined {
  const numbered = text.match(/\b(?:rule|alert|automation|subscription)\s*#?\s*(\d{1,2})\b/) || text.match(/#(\d{1,2})\b/);
  if (numbered) return { index: Number(numbered[1]) };
  if (VOID_RE.test(text)) return { trigger_type: 'transaction_voided' };
  return undefined;
}

function parseChannel(text: string): { channel: AutomationChannel; explicit: boolean } {
  if (/\b(text|texts|sms|message)\b/.test(text)) return { channel: 'sms', explicit: true };
  if (/\bemail(?:s|ed)?\b/.test(text)) return { channel: 'email', explicit: true };
  // "alert me / notify me / let me know" with no channel: default to the
  // always-live email lane; the mandatory confirm card states the channel, so
  // the user sees (and can cancel) the default before anything is saved.
  return { channel: 'email', explicit: false };
}

function parseFreeTextDestination(text: string): string | undefined {
  const email = text.match(EMAIL_ADDR_RE);
  if (email) return email[0];
  const phone = text.match(PHONE_RE);
  if (phone && digitsIn(phone[0]) >= 7) return phone[0].trim();
  return undefined;
}

function parseCadence(text: string): AutomationCadence | undefined {
  let freq: 'daily' | 'weekly' | undefined;
  if (/\b(daily|every (night|day|evening|morning)|each (night|day|evening|morning)|nightly)\b/.test(text)) freq = 'daily';
  else if (/\b(weekly|every week|each week)\b/.test(text)) freq = 'weekly';
  if (!freq) return undefined;
  const cadence: AutomationCadence = { freq };
  const time = text.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  if (time) {
    let hour = Number(time[1]);
    const minute = time[2] ? Number(time[2]) : 0;
    if (time[3] === 'pm' && hour < 12) hour += 12;
    if (time[3] === 'am' && hour === 12) hour = 0;
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      cadence.time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    }
  }
  return cadence;
}

/**
 * Parse one chat sentence into an automation intent, or null.
 * Pure and deterministic — same text always yields the same result.
 */
export function parseAutomationSentence(rawText: string): ParsedAutomation | null {
  const text = normalize(rawText);
  if (!text) return null;

  // ── list ────────────────────────────────────────────────────────────────
  if (
    (/\b(list|show|view|see)\b/.test(text) && RULE_NOUN_RE.test(text) && /\b(my|our|active|all|current|set up|setup)\b/.test(text)) ||
    (/\bwhat\b/.test(text) && RULE_NOUN_RE.test(text) && /\b(have|set up|setup|active|running)\b/.test(text))
  ) {
    return { action: 'list', confidence: 'high' };
  }

  // ── disable / delete (checked before subscribe: "stop texting me…") ─────
  const mentionsRules = RULE_NOUN_RE.test(text) || VOID_RE.test(text);
  // delete needs an explicit rule noun — bare void vocabulary ("remove voided
  // transactions from the report") is a data request, not rule management.
  if (/\b(delete|remove|get rid of)\b/.test(text) && RULE_NOUN_RE.test(text)) {
    return { action: 'delete', rule_ref: parseRuleRef(text), confidence: 'high' };
  }
  if (/\b(pause|disable|mute|turn off|unsubscribe)\b/.test(text) && mentionsRules) {
    return { action: 'disable', rule_ref: parseRuleRef(text), confidence: 'high' };
  }
  if (/\bstop\b/.test(text) && mentionsRules && /\b(stop (texting|emailing|messaging|alerting|notifying)|stop (the|my|that|this))\b/.test(text)) {
    return { action: 'disable', rule_ref: parseRuleRef(text), confidence: 'high' };
  }

  // ── subscribe: scheduled reports (recognized, NOT supported in v1) ──────
  const wantsShiftOrTender = /\b(shift|tender)\b/.test(text) && /\b(report|breakdown|summary)\b/.test(text);
  const cadence = parseCadence(text);
  if (wantsShiftOrTender && (cadence || /\b(every|each|daily|nightly|weekly)\b/.test(text))) {
    const { channel, explicit } = parseChannel(text);
    const freeText = parseFreeTextDestination(text);
    return {
      action: 'subscribe',
      kind: 'schedule',
      report_type: /\bshift\b/.test(text) ? 'shift_report' : 'tender_report',
      channel,
      cadence: cadence ?? { freq: 'daily' },
      supported: false, // no verified shift/tender data contract yet — never claim
      confidence: explicit ? 'high' : 'medium',
      ...(freeText ? { destination_free_text: freeText } : {}),
    };
  }

  // ── subscribe: event rules (v1 trigger: transaction_voided) ─────────────
  const subscribeVerb =
    /\b(text|sms|message|email|alert|notify|ping|tell|warn)\s+(me|us)\b/.test(text) ||
    /\blet\s+(me|us)\s+know\b/.test(text) ||
    /\bsend\s+(me|us)\s+(a\s+)?(text|sms|message|email|alert|notification)\b/.test(text) ||
    // free-text destination form: "text 555-0100 when…" — verb + destination, no "me"
    (/\b(text|sms|email)\b/.test(text) && Boolean(parseFreeTextDestination(text)));
  const triggerClause = /\b(when(ever)?|if|any ?time|each time|every time|on)\b/.test(text) || /\bon voids?\b/.test(text);

  if (subscribeVerb && VOID_RE.test(text) && (triggerClause || /\bvoids\b/.test(text)) && !PAST_TENSE_RE.test(text)) {
    const { channel, explicit } = parseChannel(text);
    const freeText = parseFreeTextDestination(text);
    return {
      action: 'subscribe',
      kind: 'event',
      trigger_type: 'transaction_voided',
      channel,
      supported: true,
      confidence: explicit ? 'high' : 'medium',
      ...(freeText ? { destination_free_text: freeText } : {}),
    };
  }

  return null;
}
