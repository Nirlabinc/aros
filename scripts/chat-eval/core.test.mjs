// node --test scripts/chat-eval/core.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreReply, currencyPattern, isEmptyReply, hasErrorPhrase, aggregate } from './core.mjs';

const GT = {
  summary: { todaySales: { revenue: 3008.11 } },
  lowStockNames: ['1000 STORIES  CAB. SAUV 750'],
  connectorNames: ['Party Liquor', 'RapidLab'],
};

test('currencyPattern matches grouped and plain', () => {
  const p = currencyPattern(3008.11);
  assert.ok(p.test('Total Sales: **$3,008.11**'));
  assert.ok(p.test('sales were 3008.11 today'));
  assert.ok(!p.test('sales were $2,990.00'));
});

test('empty replies fail', () => {
  assert.ok(isEmptyReply('[]'));
  assert.ok(isEmptyReply('   '));
  assert.ok(isEmptyReply(null));
  assert.ok(!isEmptyReply('You sold $5 today'));
  const s = scoreReply({ id: 'x', domain: 'sales', checks: {} }, '[]', GT);
  assert.equal(s.verdict, 'fail');
});

test('error phrases fail', () => {
  assert.equal(hasErrorPhrase('Circuit Breaker issue, try again later'), 'circuit breaker');
  const s = scoreReply({ id: 'x', domain: 'inventory', checks: {} }, 'Low stock items could not be loaded right now due to a data-source error.', GT);
  assert.equal(s.verdict, 'fail');
});

test('sales template on non-sales question is a misroute fail', () => {
  const reply = '**Party Liquor** today:\n- Total Sales: **$3,008.11**\n- Transactions: **135**';
  const s = scoreReply({ id: 'voids', domain: 'integrity', checks: {} }, reply, GT);
  assert.equal(s.verdict, 'fail');
  assert.ok(s.reasons[0].startsWith('misroute'));
});

test('correct grounded sales answer passes', () => {
  const reply = '**Party Liquor** today:\n- Total Sales: **$3,008.11**\n- Transactions: **135**';
  const s = scoreReply({ id: 'sales-today', domain: 'sales', checks: { expectCurrencyFrom: 'summary.todaySales.revenue' } }, reply, GT, { latencyMs: 1800 });
  assert.equal(s.verdict, 'pass');
});

test('wrong connector answer fails ground truth', () => {
  const s = scoreReply({ id: 'connectors', domain: 'account', checks: { expectAnyFrom: 'connectorNames' } }, 'No active connectors found for your account.', GT);
  assert.equal(s.verdict, 'fail');
});

test('placeholder tenant name warns', () => {
  const s = scoreReply({ id: 'labor', domain: 'labor', checks: {} }, 'the store had steady staffing all week with no overtime risk', GT);
  assert.equal(s.verdict, 'warn');
});

test('comparison check', () => {
  const s = scoreReply({ id: 'week-compare', domain: 'sales-range', checks: { expectComparison: true } }, 'This week you did $21k, up 4% vs last week.', GT);
  assert.equal(s.verdict, 'pass');
});

test('slow pass becomes warn', () => {
  const s = scoreReply({ id: 'x', domain: 'meta', checks: {} }, 'I can help with sales, inventory, labor and reviews.', GT, { latencyMs: 25_000 });
  assert.equal(s.verdict, 'warn');
});

test('aggregate counts by reason family', () => {
  const agg = aggregate([
    { id: 'a', verdict: 'pass', reasons: [] },
    { id: 'b', verdict: 'fail', reasons: ['misroute-sales-template: x'] },
    { id: 'c', verdict: 'fail', reasons: ['ground-truth-mismatch: y'] },
  ]);
  assert.equal(agg.pass, 1);
  assert.equal(agg.fail, 2);
  assert.equal(agg.byReason['misroute-sales-template'], 1);
});

test('mustNotContain fails on forbidden phrase', () => {
  const q = { id: 'heartbeat', domain: 'meta', checks: { mustNotContain: ['degraded'] } };
  assert.equal(scoreReply(q, 'degraded — model lane timed out', GT).verdict, 'fail');
  assert.equal(scoreReply(q, 'online (model lane verified, 900ms)', GT).verdict, 'pass');
});

test('per-question latencyBudgetMs overrides the default', () => {
  const q = { id: 'hb', domain: 'meta', latencyBudgetMs: 25000, checks: {} };
  // 22s answer: WARN under the old flat 20s, PASS under the 25s lane budget
  assert.equal(scoreReply(q, 'online (model lane verified)', GT, { latencyMs: 22000 }).verdict, 'pass');
  const fast = { id: 'conn', domain: 'account', latencyBudgetMs: 5000, checks: {} };
  // deterministic handler regressing to 8s now WARNs (was masked by 20s default)
  assert.equal(scoreReply(fast, 'You have 2 active connectors', GT, { latencyMs: 8000 }).verdict, 'warn');
});
