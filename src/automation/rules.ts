/**
 * Automation rules — pure functional core (no I/O).
 *
 * Fingerprinting, confirm-card rendering, stateless confirm-flow detection,
 * and create-precondition evaluation for chat-registered automation rules.
 * The imperative shell (src/server.ts) does all reads/writes; everything here
 * is deterministic data-in/data-out (mission: docs/missions/aros-automation-rules.md).
 */

import { createHash } from 'node:crypto';
import type { RuleRef } from './parse.js';

export const MAX_ENABLED_RULES = 25;
export const CONFIRM_MARKER = 'aros-automation-confirm';

/**
 * Trigger → NOTIFICATION_CATALOG event id. Doubles as the v1 trigger
 * whitelist: a confirmed rule whose trigger is not a key here is rejected.
 */
export const AUTOMATION_CATALOG_EVENT: Record<string, string> = {
  transaction_voided: 'void-alert',
};

export interface RuleSpec {
  tenant_id: string;
  kind: 'event' | 'schedule';
  trigger_type?: string | null;
  report_type?: string | null;
  /** Store scope; v1 is always 'all-stores'. */
  scope?: string | null;
  channel: 'email' | 'sms';
  /** Reference to a prefs-registered destination — never a raw address. */
  destination_ref: string;
  cadence?: { freq: 'daily' | 'weekly'; time?: string; tz?: string } | null;
  params?: Record<string, unknown>;
}

export interface ExistingRule {
  id: string;
  fingerprint: string;
  status: string;
  created_at: string;
  trigger_type?: string | null;
  report_type?: string | null;
  channel?: string;
}

/** Recursively sort object keys so param order never changes the fingerprint. */
function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortValue((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * Canonical rule fingerprint — duplicate-protection layer 1. Two rules that
 * mean the same thing (same tenant, trigger/report, scope, channel,
 * destination, cadence, params) always hash identically no matter how the
 * sentence was worded or which surface created them.
 */
export function canonicalFingerprint(rule: RuleSpec): string {
  const canonical = {
    v: 1,
    tenant_id: rule.tenant_id,
    kind: rule.kind,
    trigger_type: rule.trigger_type ?? null,
    report_type: rule.report_type ?? null,
    scope: rule.scope ?? 'all-stores',
    channel: rule.channel,
    destination_ref: rule.destination_ref,
    cadence: rule.cadence ? sortValue(rule.cadence) : null,
    params: sortValue(rule.params ?? {}),
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

// ── Labels ─────────────────────────────────────────────────────────────────

const TRIGGER_LABELS: Record<string, string> = {
  transaction_voided: 'a transaction is voided',
};

export function triggerLabel(triggerType: string | null | undefined): string {
  return (triggerType && TRIGGER_LABELS[triggerType]) || String(triggerType || 'unknown trigger');
}

export function channelLabel(channel: string): string {
  return channel === 'sms' ? 'text (SMS)' : 'email';
}

/** Mask a destination for display — chat never echoes a full phone/address. */
export function maskDestination(channel: string, destination: string | null | undefined): string {
  if (!destination) return channel === 'sms' ? 'your registered mobile number' : 'your account email';
  if (channel === 'sms') {
    const digits = destination.replace(/\D/g, '');
    return digits.length >= 4 ? `number ending in ${digits.slice(-4)}` : 'your registered mobile number';
  }
  const at = destination.indexOf('@');
  if (at > 0) return `${destination[0]}•••${destination.slice(at)}`;
  return 'your account email';
}

// ── Confirm card ───────────────────────────────────────────────────────────

export interface ConfirmContext {
  /** Human label for where the alert will go (already masked). */
  destinationLabel: string;
  storeLabel?: string;
  connectorConnected: boolean;
  /** Enabled rules of the same trigger/report type (fuzzy-dupe layer 2). */
  similar?: Array<{ index: number; description: string; created_at: string }>;
}

/**
 * The exact confirm text chat renders. Embeds a machine-readable copy of the
 * rule in an HTML comment so the STATELESS confirm turn can recover it from
 * message history (see the save-path banner in src/server.ts).
 */
export function confirmationCard(rule: RuleSpec, context: ConfirmContext): string {
  const lines: string[] = ['**Set up this automation?**'];
  if (rule.kind === 'event') {
    lines.push(`- When: ${triggerLabel(rule.trigger_type)}`);
  } else {
    const cadence = rule.cadence;
    const when = cadence ? `${cadence.freq}${cadence.time ? ` at ${cadence.time}` : ''}${cadence.tz ? ` (${cadence.tz})` : ''}` : 'on a schedule';
    lines.push(`- Report: ${rule.report_type || 'report'} — ${when}`);
  }
  lines.push(`- Alert via: ${channelLabel(rule.channel)} → ${context.destinationLabel}`);
  lines.push(`- Stores: ${context.storeLabel || 'all connected stores'}`);
  if (!context.connectorConnected) {
    lines.push('- Status after save: **pending connector** — no connected POS yet, so this rule will wait (it activates automatically once your store is connected, and never fires on history from before activation). You can connect your store on the Connections page (/onboarding).');
  } else {
    lines.push('- Status after save: active');
  }
  if (context.similar?.length) {
    lines.push('');
    lines.push(`You already have ${context.similar.length} similar ${context.similar.length === 1 ? 'rule' : 'rules'} for this trigger:`);
    for (const s of context.similar) {
      lines.push(`${s.index}. ${s.description} (created ${s.created_at.slice(0, 10)})`);
    }
    lines.push('Update the existing rule or create a separate one? Replying **confirm** creates this as a separate rule; reply **cancel** to keep just the existing one (say "list my alerts" to manage it).');
  }
  lines.push('');
  lines.push('Reply **confirm** to save this rule, or **cancel** to discard it.');
  const payload = Buffer.from(JSON.stringify({ v: 1, rule }), 'utf8').toString('base64');
  lines.push(`<!--${CONFIRM_MARKER}:${payload}-->`);
  return lines.join('\n');
}

// ── Stateless confirm-flow detection ───────────────────────────────────────

export type ConfirmReply =
  | { state: 'confirm'; rule: RuleSpec }
  | { state: 'cancel'; rule: RuleSpec }
  | { state: 'other'; rule: RuleSpec };

function messageText(message: unknown): string {
  const rec = message as Record<string, unknown> | null;
  const content = rec?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part === 'string' ? part : String((part as Record<string, unknown>)?.text ?? ''))).join(' ');
  }
  return '';
}

export function extractConfirmPayload(text: string): RuleSpec | null {
  const match = text.match(new RegExp(`<!--${CONFIRM_MARKER}:([A-Za-z0-9+/=]+)-->`));
  if (!match) return null;
  try {
    const decoded = JSON.parse(Buffer.from(match[1], 'base64').toString('utf8')) as { v?: number; rule?: RuleSpec };
    if (decoded?.v !== 1 || !decoded.rule || typeof decoded.rule !== 'object') return null;
    const rule = decoded.rule;
    if (typeof rule.tenant_id !== 'string' || typeof rule.destination_ref !== 'string') return null;
    if (rule.kind !== 'event' && rule.kind !== 'schedule') return null;
    if (rule.channel !== 'email' && rule.channel !== 'sms') return null;
    return rule;
  } catch {
    return null;
  }
}

const CONFIRM_RE = /^(confirm|yes|yep|yeah|ok(ay)?|sure|go ahead|do it|save( it)?|create( it)?)[.! ]*$/;
const CANCEL_RE = /^(cancel|no|nope|stop|discard|never ?mind|don'?t)[.! ]*$/;

/**
 * Detect a pending confirm in the conversation: the most recent assistant
 * message carries a confirm card and the latest user message answers it.
 * Returns null when no confirm is pending (normal parsing applies).
 */
export function detectConfirmReply(messages: unknown[]): ConfirmReply | null {
  if (!Array.isArray(messages) || messages.length < 2) return null;
  const last = messages[messages.length - 1] as Record<string, unknown>;
  if (last?.role !== 'user') return null;
  // Nearest preceding assistant message must be the confirm card — an
  // intervening assistant turn means the card was abandoned.
  for (let i = messages.length - 2; i >= 0; i--) {
    const message = messages[i] as Record<string, unknown>;
    if (message?.role !== 'assistant') continue;
    const rule = extractConfirmPayload(messageText(message));
    if (!rule) return null;
    const answer = messageText(last).toLowerCase().replace(/\s+/g, ' ').trim();
    if (CONFIRM_RE.test(answer)) return { state: 'confirm', rule };
    if (CANCEL_RE.test(answer)) return { state: 'cancel', rule };
    return { state: 'other', rule };
  }
  return null;
}

// ── Create preconditions ───────────────────────────────────────────────────

export type CreateDecision =
  | { decision: 'ok' }
  | { decision: 'needs_confirm' }
  | { decision: 'reject_role' }
  | { decision: 'reject_destination' }
  | { decision: 'reject_cap'; cap: number }
  | { decision: 'duplicate_exact'; existing: ExistingRule }
  | { decision: 'similar_exists'; similar: ExistingRule[] }
  | { decision: 'pending_connector' };

export interface CreateContext {
  role: string;
  /** Rules counted against the cap (status != 'disabled'). */
  existingRulesCount: number;
  /** Enabled rules with the same trigger/report type. */
  existingSameTypeRules: ExistingRule[];
  connectorConnected: boolean;
  destinationRegistered: boolean;
  fingerprint: string;
  /** 'propose' = before the confirm card; 'save' = after user confirmed. */
  stage: 'propose' | 'save';
}

/**
 * One pure decision for rule creation. Precedence: authority rails first
 * (role, destination), then exact dupe, then caps, then the confirm/similar
 * flow, then connector state.
 */
export function evaluateCreatePreconditions(ctx: CreateContext): CreateDecision {
  if (!['owner', 'admin'].includes(ctx.role)) return { decision: 'reject_role' };
  if (!ctx.destinationRegistered) return { decision: 'reject_destination' };
  const exact = ctx.existingSameTypeRules.find((r) => r.fingerprint === ctx.fingerprint && r.status !== 'disabled');
  if (exact) return { decision: 'duplicate_exact', existing: exact };
  if (ctx.existingRulesCount >= MAX_ENABLED_RULES) return { decision: 'reject_cap', cap: MAX_ENABLED_RULES };
  if (ctx.stage === 'propose') {
    const similar = ctx.existingSameTypeRules.filter((r) => r.status !== 'disabled');
    if (similar.length) return { decision: 'similar_exists', similar };
    return { decision: 'needs_confirm' };
  }
  if (!ctx.connectorConnected) return { decision: 'pending_connector' };
  return { decision: 'ok' };
}

/** Destination reference for a prefs-registered destination — never raw. */
export function buildDestinationRef(channel: 'email' | 'sms', userId: string): string {
  return `prefs:${channel}:${userId}`;
}

/**
 * Sanitize a confirmed rule payload: keep only the fields the user actually
 * chose (trigger + channel) and RE-DERIVE everything else server-side.
 * Returns null for anything outside the v1 contract (schedules, unknown
 * triggers, foreign tenant) — the payload round-trips through the client and
 * is never trusted.
 */
export function sanitizeConfirmedRule(payload: RuleSpec, ctx: { tenantId: string; userId: string }): RuleSpec | null {
  if (!payload || payload.tenant_id !== ctx.tenantId) return null;
  if (payload.kind !== 'event') return null; // schedules are refused in v1 (honesty rule)
  if (typeof payload.trigger_type !== 'string' || !(payload.trigger_type in AUTOMATION_CATALOG_EVENT)) return null;
  if (payload.channel !== 'email' && payload.channel !== 'sms') return null;
  return {
    tenant_id: ctx.tenantId,
    kind: 'event',
    trigger_type: payload.trigger_type,
    report_type: null,
    scope: 'all-stores',
    channel: payload.channel,
    destination_ref: buildDestinationRef(payload.channel, ctx.userId),
    cadence: null,
    params: {},
  };
}

/** The event_subscriptions insert row. Watermark = activation timestamp: set
 * now for active rules; pending_connector stays NULL until the 1b activation
 * sweep sets it (so a late-connected rule never fires on backlog). */
export function insertRowForRule(rule: RuleSpec, opts: { status: 'active' | 'pending_connector'; userId: string; fingerprint: string; now: string }): Record<string, unknown> {
  return {
    tenant_id: rule.tenant_id,
    created_by: opts.userId,
    created_via: 'chat',
    kind: rule.kind,
    trigger_type: rule.trigger_type ?? null,
    report_type: rule.report_type ?? null,
    params: rule.params ?? {},
    channel: rule.channel,
    destination_ref: rule.destination_ref,
    cadence: rule.cadence ?? null,
    status: opts.status,
    fingerprint: opts.fingerprint,
    watermark: opts.status === 'active' ? opts.now : null,
  };
}

/**
 * The rule itself is the opt-in: an ACTIVE save also enables the matching
 * notification_preferences row for the creator's channel, so /notifications
 * reflects reality and 1b's isEnabled delivery gate lines up with what chat
 * promised. Returns null when nothing should be written (pending_connector —
 * the 1b activation sweep writes it on activation; unknown trigger).
 */
export function prefRowForActiveRule(rule: RuleSpec, opts: { status: string; userId: string; destination: string | null; now: string }): Record<string, unknown> | null {
  if (opts.status !== 'active') return null;
  const event = rule.trigger_type ? AUTOMATION_CATALOG_EVENT[rule.trigger_type] : undefined;
  if (!event) return null;
  return {
    tenant_id: rule.tenant_id,
    user_id: opts.userId,
    event_type: event,
    channel: rule.channel,
    enabled: true,
    destination: opts.destination,
    updated_at: opts.now,
  };
}

/** Duplicate answer that reports the existing rule's REAL status. */
export function duplicateReply(status: string, createdAt?: string | null): string {
  const state =
    status === 'active' ? "it's active"
    : status === 'pending_connector' ? "it's waiting on your store connection"
    : status === 'suspended' ? "it's suspended (paused after too many fires)"
    : `its status is ${status.replace(/_/g, ' ')}`;
  return `You already have this rule${createdAt ? ` (created ${createdAt.slice(0, 10)})` : ''} — ${state}. Nothing new was created.`;
}

/**
 * Resolve a chat rule reference ("rule 2", "the void alert") against the
 * tenant's rules (created_at asc, matching the numbered list chat renders).
 */
export function resolveRuleRef<T extends { trigger_type?: string | null }>(
  rules: T[],
  ref: RuleRef | undefined,
): { rule: T } | { error: 'not_found' | 'ambiguous' | 'no_ref' } {
  if (!ref) return rules.length === 1 ? { rule: rules[0] } : { error: rules.length ? 'ambiguous' : 'not_found' };
  if (typeof ref.index === 'number') {
    const rule = rules[ref.index - 1];
    return rule ? { rule } : { error: 'not_found' };
  }
  if (ref.trigger_type) {
    const matches = rules.filter((r) => r.trigger_type === ref.trigger_type);
    if (matches.length === 1) return { rule: matches[0] };
    return { error: matches.length ? 'ambiguous' : 'not_found' };
  }
  return { error: 'no_ref' };
}

/** One-line human description of a stored rule (list intent + similar section). */
export function describeRule(rule: { kind: string; trigger_type?: string | null; report_type?: string | null; channel: string; status: string }): string {
  const what = rule.kind === 'event' ? `when ${triggerLabel(rule.trigger_type)}` : `${rule.report_type || 'report'} (scheduled)`;
  return `${channelLabel(rule.channel)} ${what} — ${rule.status.replace(/_/g, ' ')}`;
}

// ══════════════════════════════════════════════════════════════════════════
// Slice 1b — sentinel execution core (pure). The imperative shell in
// src/server.ts loads rules/connectors/invoices/audit and applies these
// decisions; everything below is deterministic data-in/data-out and unit-
// tested in src/__tests__/automation-sentinel.test.ts.
// ══════════════════════════════════════════════════════════════════════════

/** Volume rails (contract "Volume rails"). SMS cannot be recalled — these caps
 * bound blast radius on a data-anomaly storm (precedent: aros#109). */
export const AUTOMATION_MAX_FIRES_PER_HOUR = 5;
export const AUTOMATION_MAX_FIRES_PER_TENANT_DAY = 50;
/** Business-day lookback the sentinel scans for voids each pass — a small
 * safety window so a brief outage still catches a recent void (the watermark +
 * per-invoice dedupe make a wider window idempotent, never a re-fire). */
export const AUTOMATION_SENTINEL_WINDOW_DAYS = 2;

// ── Activation sweep decision (pending_connector ↔ active) ───────────────────

export type ActivationDecision = 'activate' | 'deactivate' | 'none';

/**
 * Idempotent, path-independent activation decision (contract "Connector
 * precondition"). A rule waiting on a connector activates the moment one is
 * connected (however it connected); an active rule whose connector disappeared
 * flips back to pending_connector (visible, never a silent no-op). Everything
 * else is a no-op — running this every pass converges without a backlog burst.
 */
export function decideActivation(status: string, connectorConnected: boolean): ActivationDecision {
  if (status === 'pending_connector' && connectorConnected) return 'activate';
  if (status === 'active' && !connectorConnected) return 'deactivate';
  return 'none';
}

// ── Void diff (new-void detection) ───────────────────────────────────────────

/** True when an event time is strictly after the activation watermark. Parses
 * both sides (formats can differ) and fails CLOSED — an unparseable/absent
 * event time is treated as NOT-after, so a newly-activated rule never fires on
 * a row it cannot prove post-dates activation (contract: no retroactive fire). */
export function isAfterWatermark(eventTime: string | null | undefined, watermark: string | null | undefined): boolean {
  if (!watermark) return false;
  const wm = Date.parse(watermark);
  if (!Number.isFinite(wm)) return false;
  if (!eventTime) return false;
  const et = Date.parse(eventTime);
  if (!Number.isFinite(et)) return false;
  return et > wm;
}

/** Fail-closed CALENDAR-DAY comparison for timestamp-less rows. A void with
 * only a business date can only be placed to the day, so it fires ONLY when its
 * day is strictly after the watermark's day — a SAME-day void (which may
 * predate a same-day activation) is suppressed. This closes the activation-day
 * backlog hole an end-of-day timestamp fallback would open. */
export function isBusinessDayAfterWatermark(businessDate: string | null | undefined, watermark: string | null | undefined): boolean {
  if (!businessDate || !watermark) return false;
  const day = businessDate.slice(0, 10);
  const wmDay = watermark.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{4}-\d{2}-\d{2}$/.test(wmDay)) return false;
  return day > wmDay;
}

/** PURE: does this voided invoice PROVABLY post-date the activation watermark?
 * Precise when the row carries a timestamp (strictly after); otherwise it falls
 * back to the fail-closed calendar-day rule above — never an end-of-day stamp
 * that could jump a same-day backlog void past a same-day activation. */
export function voidIsAfterWatermark(inv: { timestamp: string | null; businessDate: string | null }, watermark: string | null | undefined): boolean {
  if (!watermark) return false;
  if (inv.timestamp) return isAfterWatermark(inv.timestamp, watermark);
  return isBusinessDayAfterWatermark(inv.businessDate, watermark);
}

export interface InvoiceLike {
  invoiceNo: string | null;
  recordId: string | null;
  businessDate: string | null;
  timestamp: string | null;
  amount: number | null;
  isVoid: boolean;
}

export interface VoidCandidateInvoice {
  invoiceNo: string;
  recordId: string | null;
  businessDate: string | null;
  timestamp: string | null;
  amount: number | null;
}

/** Delivery/dedupe identity for a fire: one message per (invoice, channel,
 * destination) — the coalescing + cross-pass no-refire key (contract). */
export function fireDedupeKey(invoiceNo: string, channel: string, destination: string | null): string {
  return `${invoiceNo}|${channel}|${destination ?? ''}`;
}

export interface AutomationFireClaimRow {
  tenant_id: string;
  rule_id: string | null;
  invoice_no: string;
  channel: string;
  destination: string;
}

/**
 * PURE: the automation_fires CLAIM row. Its key columns (tenant_id, invoice_no,
 * channel, destination) MUST equal the coalesce/dedupe key so the DB UNIQUE
 * constraint is the single at-most-once send authority (claim-before-send). The
 * shell inserts this with ON CONFLICT DO NOTHING; a returned id = claimed (send
 * now), no row = already sent by a prior pass or another replica (skip).
 */
export function automationFireClaim(tenantId: string, candidate: { rule_id?: string | null; invoiceNo: string; channel: string; destination: string }): AutomationFireClaimRow {
  return {
    tenant_id: tenantId,
    rule_id: candidate.rule_id ?? null,
    invoice_no: candidate.invoiceNo,
    channel: candidate.channel,
    destination: candidate.destination,
  };
}

/**
 * PURE: which voided invoices are NEW for one rule this pass — voided, provably
 * after the rule's activation watermark (backlog guard via voidIsAfterWatermark
 * — timestamp when present, else a fail-closed calendar-day rule), and not in
 * the already-fired set (cross-pass dedupe). No watermark ⇒ not activated ⇒
 * never fires.
 */
export function newVoidsForRule(
  invoices: InvoiceLike[],
  opts: { watermark: string | null; alreadyFired: Set<string>; channel: string; destination: string | null },
): VoidCandidateInvoice[] {
  if (!opts.watermark) return [];
  const out: VoidCandidateInvoice[] = [];
  for (const inv of invoices) {
    if (!inv.isVoid) continue;
    const id = inv.invoiceNo ?? inv.recordId;
    if (!id) continue;
    if (!voidIsAfterWatermark(inv, opts.watermark)) continue;
    if (opts.alreadyFired.has(fireDedupeKey(id, opts.channel, opts.destination))) continue;
    out.push({ invoiceNo: id, recordId: inv.recordId, businessDate: inv.businessDate, timestamp: inv.timestamp, amount: inv.amount });
  }
  return out;
}

/**
 * Delivery-time coalescing (contract): collapse overlapping rule matches so
 * exactly one fire is recorded per (invoiceNo, channel, destination). Input
 * order is preserved; the first candidate for a key wins.
 */
export function coalesceFires<T extends { invoiceNo: string; channel: string; destination: string | null }>(candidates: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const c of candidates) {
    const key = fireDedupeKey(c.invoiceNo, c.channel, c.destination);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

// ── Volume caps ──────────────────────────────────────────────────────────────

export interface RateWindow {
  firesInWindow: number;
  windowStartedAt: string | null;
}
export interface RateResult {
  allowed: boolean;
  /** True ⇒ this fire breaches the hourly cap; the shell suspends the rule. */
  suspend: boolean;
  nextFiresInWindow: number;
  nextWindowStartedAt: string;
}

/**
 * PURE per-rule hourly cap. Sliding fixed window: a window older than one hour
 * resets before this fire is counted. Called ONCE per intended fire — the 6th
 * fire inside the hour returns { allowed:false, suspend:true } and the rule is
 * paused (contract "Volume rails" (a)).
 */
export function applyPerRuleRateLimit(window: RateWindow, now: string, max = AUTOMATION_MAX_FIRES_PER_HOUR): RateResult {
  const nowMs = Date.parse(now);
  const startMs = window.windowStartedAt ? Date.parse(window.windowStartedAt) : NaN;
  const withinWindow = Number.isFinite(startMs) && Number.isFinite(nowMs) && nowMs - startMs < 3_600_000;
  const currentCount = withinWindow ? window.firesInWindow : 0;
  const windowStart = withinWindow && window.windowStartedAt ? window.windowStartedAt : now;
  if (currentCount >= max) {
    return { allowed: false, suspend: true, nextFiresInWindow: currentCount, nextWindowStartedAt: windowStart };
  }
  return { allowed: true, suspend: false, nextFiresInWindow: currentCount + 1, nextWindowStartedAt: windowStart };
}

/** PURE per-tenant daily aggregate cap (contract "Volume rails" (b)). Once the
 * tenant has fired `max` times today, firing STOPS for that tenant (the shell
 * logs the stop — never a silent drop). */
export function tenantDailyCapReached(firesToday: number, max = AUTOMATION_MAX_FIRES_PER_TENANT_DAY): boolean {
  return firesToday >= max;
}

// ── Void-alert message ───────────────────────────────────────────────────────

/** The concrete alert text a fire delivers. Amount is honest about missing
 * data (the API can omit it) rather than printing $0.00. */
export function voidAlertMessage(
  storeName: string,
  invoice: { invoiceNo: string; amount: number | null; timestamp: string | null; businessDate: string | null },
): { subject: string; text: string } {
  const amount = typeof invoice.amount === 'number' && Number.isFinite(invoice.amount)
    ? `$${invoice.amount.toFixed(2)}`
    : 'an unlisted amount';
  const when = invoice.timestamp || invoice.businessDate || 'just now';
  return {
    subject: `Voided transaction at ${storeName}`,
    text: `Voided transaction at ${storeName}: ${amount}, ${when}, invoice ${invoice.invoiceNo}.`,
  };
}

/** The paused-too-many-fires notice (sent exactly once when a rule suspends). */
export function ruleSuspendedMessage(storeLabel: string): { subject: string; text: string } {
  return {
    subject: 'Automation paused — too many alerts',
    text: `Your void alert for ${storeLabel} fired more than ${AUTOMATION_MAX_FIRES_PER_HOUR} times in an hour, so I paused it to avoid a storm of messages. Nothing else changed. Re-enable it from the Notifications page once things look normal.`,
  };
}

/** The test-fire text — CLEARLY labeled so it is never mistaken for a real
 * void (contract test-fire: audit-tagged test, doesn't count toward caps). */
export function testFireMessage(storeLabel: string, channel: string): { subject: string; text: string } {
  return {
    subject: 'TEST — your void alert is live',
    text: `This is a TEST of your void alert${storeLabel ? ` for ${storeLabel}` : ''}. No transaction was voided. When a real void happens I'll ${channel === 'sms' ? 'text' : 'email'} you like this. (Test messages don't count toward your alert limits.)`,
  };
}
