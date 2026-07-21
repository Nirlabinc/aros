// Pure triage logic: turn a chat-eval run's scores into deduplicated task
// intents. No I/O — the shell (triage.mjs) decides how to file them.

/** Reason families that are engineering defects (file a GitHub issue). */
const ENGINEERING_FAMILIES = new Set([
  'empty-reply',
  'tool-error',
  'misroute-sales-template',
  'no-comparison',
  'tenant-name-missing',
  'transport',
]);

export function reasonFamily(reason) {
  return String(reason).split(':')[0].trim();
}

export function fingerprint(questionId, family) {
  return `chat-eval/${questionId}/${family}`;
}

/**
 * rows: results.jsonl rows ({ workspace, tenantId, id, q, ms, reply, score }).
 * Returns issue intents grouped by (question, family), each listing the
 * workspaces affected, plus the operational rows that belong in the digest
 * instead of the issue tracker.
 */
export function buildTriage(rows) {
  const issues = new Map();
  const operational = [];
  for (const row of rows) {
    const score = row.score ?? {};
    if (score.verdict === 'pass') continue;
    for (const reason of score.reasons ?? []) {
      const family = reasonFamily(reason);
      if (!ENGINEERING_FAMILIES.has(family)) {
        operational.push({ workspace: row.workspace, tenantId: row.tenantId, questionId: row.id, reason });
        continue;
      }
      const fp = fingerprint(row.id, family);
      if (!issues.has(fp)) {
        issues.set(fp, {
          fingerprint: fp,
          family,
          questionId: row.id,
          question: row.q,
          title: `chat-eval: ${family} on "${row.id}"`,
          workspaces: [],
          examples: [],
        });
      }
      const issue = issues.get(fp);
      if (!issue.workspaces.includes(row.workspace)) issue.workspaces.push(row.workspace);
      if (issue.examples.length < 3) issue.examples.push({ workspace: row.workspace, reason, reply: String(row.reply ?? row.err ?? '').slice(0, 400) });
    }
  }
  return { issues: [...issues.values()], operational };
}

export function renderIssueBody(issue, runMeta) {
  const lines = [
    `Automated finding from the chat-eval harness (run ${runMeta.when}, base ${runMeta.base}).`,
    '',
    `**Question** (\`${issue.questionId}\`): ${issue.question}`,
    `**Failure family**: \`${issue.family}\``,
    `**Workspaces affected**: ${issue.workspaces.join(', ')}`,
    '',
    '### Examples',
  ];
  for (const ex of issue.examples) {
    lines.push('', `- ${ex.workspace} — ${ex.reason}`, '  > ' + ex.reply.split('\n').join('\n  > '));
  }
  lines.push('', `Fingerprint: \`${issue.fingerprint}\` (dedup key — do not edit)`);
  return lines.join('\n');
}

export function renderRecurrenceComment(issue, runMeta) {
  return `Still failing on ${runMeta.when} (${issue.workspaces.length} workspace(s): ${issue.workspaces.join(', ')}).`;
}

/**
 * Decide create-vs-comment for each intent given currently-open issues
 * ({ number, title, body }). Dedup key is the fingerprint embedded in the body.
 */
export function planIssueActions(intents, openIssues) {
  const open = new Map();
  for (const gh of openIssues) {
    const m = String(gh.body ?? '').match(/Fingerprint: `([^`]+)`/);
    if (m) open.set(m[1], gh.number);
  }
  return intents.map((intent) => open.has(intent.fingerprint)
    ? { action: 'comment', number: open.get(intent.fingerprint), intent }
    : { action: 'create', intent });
}

export function buildDigestPayload({ summary, operational, runMeta }) {
  return {
    kind: 'chat-eval',
    when: runMeta.when,
    base: runMeta.base,
    fleetPassRate: summary.passRate,
    workspaces: summary.workspaces?.map((w) => ({ workspace: w.workspace, name: w.name, pass: w.pass, total: w.total, passRate: w.passRate, error: w.error })) ?? [],
    operationalSignals: operational,
  };
}
