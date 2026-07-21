// node --test scripts/chat-eval/triage-core.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTriage, planIssueActions, renderIssueBody, fingerprint } from './triage-core.mjs';

const ROWS = [
  { workspace: 'a@x.com', tenantId: 't1', id: 'sales-today', q: 'Sales?', reply: 'ok', score: { verdict: 'pass', reasons: [] } },
  { workspace: 'a@x.com', tenantId: 't1', id: 'voids', q: 'Voids?', reply: 'Total Sales: $1', score: { verdict: 'fail', reasons: ['misroute-sales-template: non-sales question answered with the sales summary'] } },
  { workspace: 'b@y.com', tenantId: 't2', id: 'voids', q: 'Voids?', reply: 'Total Sales: $2', score: { verdict: 'fail', reasons: ['misroute-sales-template: non-sales question answered with the sales summary'] } },
  { workspace: 'a@x.com', tenantId: 't1', id: 'connectors', q: 'Connectors?', reply: 'none', score: { verdict: 'fail', reasons: ['ground-truth-mismatch: none of connectorNames appear'] } },
];

test('groups engineering failures by (question, family) across workspaces', () => {
  const { issues, operational } = buildTriage(ROWS);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].fingerprint, fingerprint('voids', 'misroute-sales-template'));
  assert.deepEqual(issues[0].workspaces, ['a@x.com', 'b@y.com']);
  // ground-truth-mismatch is tenant-data, not a code defect -> digest lane
  assert.equal(operational.length, 1);
  assert.equal(operational[0].questionId, 'connectors');
});

test('planIssueActions dedups by fingerprint in issue body', () => {
  const { issues } = buildTriage(ROWS);
  const body = renderIssueBody(issues[0], { when: 'now', base: 'b' });
  const actions = planIssueActions(issues, [{ number: 42, title: 'x', body }]);
  assert.deepEqual(actions.map((a) => a.action), ['comment']);
  assert.equal(actions[0].number, 42);
  const fresh = planIssueActions(issues, []);
  assert.deepEqual(fresh.map((a) => a.action), ['create']);
});

test('issue body embeds fingerprint and examples', () => {
  const { issues } = buildTriage(ROWS);
  const body = renderIssueBody(issues[0], { when: '2026-07-21T00:00:00Z', base: 'https://app.aros.live' });
  assert.match(body, /Fingerprint: `chat-eval\/voids\/misroute-sales-template`/);
  assert.match(body, /Workspaces affected.*a@x\.com, b@y\.com/);
});
