// Pure scoring core for the chat eval harness. No I/O — everything here is
// unit-testable with plain asserts (see core.test.mjs).

const ERROR_PHRASES = [
  'could not be loaded',
  'circuit breaker',
  'unable to retrieve',
  'try again later',
  'data-source error',
  'an error occurred',
  'something went wrong',
  'contact an administrator',
];

const SALES_TEMPLATE = /total sales:.*transactions:/is;
const PLACEHOLDER_TENANT = /\bthe store\b/i;

export function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/** "3008.11" -> matches "$3,008.11", "3008.11", "3,008" in a reply. */
export function currencyPattern(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return null;
  const [int] = n.toFixed(2).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return new RegExp(`(${grouped}|${int})(\\.\\d{2})?`);
}

export function isEmptyReply(reply) {
  if (reply == null) return true;
  const t = String(reply).trim();
  if (t.length === 0) return true;
  if (/^[\[\]{}",\s]*$/.test(t)) return true; // raw "[]", "{}", stray JSON punctuation
  return t.length < 3;
}

export function hasErrorPhrase(reply) {
  const t = String(reply ?? '').toLowerCase();
  return ERROR_PHRASES.find((p) => t.includes(p)) ?? null;
}

/**
 * Score one battery answer against its declared checks and the tenant's
 * ground truth. Returns { id, verdict: 'pass'|'warn'|'fail', reasons: [] }.
 */
export function scoreReply(question, reply, groundTruth, opts = {}) {
  const reasons = [];
  const checks = question.checks ?? {};
  const text = String(reply ?? '');
  // Per-question budget wins, then caller default, then 20s. Deterministic
  // handlers get a tight budget (catch a real regression); the on-prem 70B
  // lane legitimately takes ~15-20s to generate a full answer, so a flat 20s
  // cried wolf on inherent latency while masking fast-path regressions.
  const latencyBudgetMs = question.latencyBudgetMs ?? opts.latencyBudgetMs ?? 20_000;

  if (isEmptyReply(reply)) {
    return { id: question.id, verdict: 'fail', reasons: ['empty-reply: raw/blank output leaked to user'] };
  }

  const errPhrase = hasErrorPhrase(text);
  if (errPhrase) {
    return { id: question.id, verdict: 'fail', reasons: [`tool-error: reply is an error message ("${errPhrase}")`] };
  }

  // Misroute: a non-sales question answered with the sales-summary template.
  if (!checks.allowSalesTemplate && !question.domain.startsWith('sales') && SALES_TEMPLATE.test(text)) {
    reasons.push('misroute-sales-template: non-sales question answered with the sales summary');
  }

  if (PLACEHOLDER_TENANT.test(text)) {
    reasons.push('tenant-name-missing: reply says "the store" instead of the business name');
  }

  if (checks.expectCurrencyFrom) {
    const amount = getPath(groundTruth, checks.expectCurrencyFrom);
    const pat = currencyPattern(amount);
    if (pat && !pat.test(text)) {
      reasons.push(`ground-truth-mismatch: expected ${checks.expectCurrencyFrom}=${amount} to appear in the reply`);
    }
  }

  if (checks.expectAnyFrom) {
    const names = getPath(groundTruth, checks.expectAnyFrom) ?? [];
    if (names.length > 0) {
      const hit = names.some((n) => text.toLowerCase().includes(String(n).toLowerCase()));
      if (!hit) reasons.push(`ground-truth-mismatch: none of ${checks.expectAnyFrom} [${names.join(', ')}] appear in the reply`);
    }
  }

  if (Array.isArray(checks.mustNotContain)) {
    for (const s of checks.mustNotContain) {
      if (text.toLowerCase().includes(String(s).toLowerCase())) {
        reasons.push(`must-not-contain: reply contains "${s}"`);
      }
    }
  }

  if (checks.expectComparison) {
    const comparative = /\b(last week|previous|vs\.?|compared|up|down|higher|lower|increase|decrease|change)\b/i;
    if (!comparative.test(text)) reasons.push('no-comparison: reply contains no week-over-week comparison');
  }

  const hardFail = reasons.some((r) => r.startsWith('misroute') || r.startsWith('ground-truth-mismatch') || r.startsWith('no-comparison') || r.startsWith('must-not-contain'));
  let verdict = hardFail ? 'fail' : reasons.length > 0 ? 'warn' : 'pass';

  if (verdict === 'pass' && opts.latencyMs != null && opts.latencyMs > latencyBudgetMs) {
    verdict = 'warn';
    reasons.push(`slow: ${opts.latencyMs}ms exceeds ${latencyBudgetMs}ms budget`);
  }

  return { id: question.id, verdict, reasons };
}

export function aggregate(scores) {
  const total = scores.length;
  const pass = scores.filter((s) => s.verdict === 'pass').length;
  const warn = scores.filter((s) => s.verdict === 'warn').length;
  const fail = scores.filter((s) => s.verdict === 'fail').length;
  const byReason = {};
  for (const s of scores) {
    for (const r of s.reasons) {
      const key = r.split(':')[0];
      byReason[key] = (byReason[key] ?? 0) + 1;
    }
  }
  return { total, pass, warn, fail, passRate: total ? pass / total : 0, byReason };
}

export function renderReport({ workspace, when, results, scores, summary }) {
  const lines = [];
  lines.push(`# Chat eval — ${workspace.name ?? workspace.tenantId}`);
  lines.push('');
  lines.push(`- When: ${when}`);
  lines.push(`- Tenant: ${workspace.tenantId}`);
  lines.push(`- User: ${workspace.email}`);
  lines.push(`- Score: **${summary.pass}/${summary.total} pass** (${summary.warn} warn, ${summary.fail} fail)`);
  lines.push('');
  lines.push('| # | Question | Verdict | Latency | Notes |');
  lines.push('|---|---|---|---|---|');
  for (const r of results) {
    const s = scores.find((x) => x.id === r.id);
    const note = s.reasons.join('; ').replace(/\|/g, '/') || '—';
    lines.push(`| ${r.id} | ${r.q.replace(/\|/g, '/')} | ${s.verdict.toUpperCase()} | ${r.ms}ms | ${note} |`);
  }
  lines.push('');
  lines.push('## Replies');
  for (const r of results) {
    lines.push('');
    lines.push(`### ${r.id} (${r.ms}ms, HTTP ${r.status})`);
    lines.push('> ' + String(r.reply ?? r.err ?? '(no reply)').split('\n').join('\n> '));
  }
  return lines.join('\n') + '\n';
}
