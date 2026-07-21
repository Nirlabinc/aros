#!/usr/bin/env node
// Triage shell: turn the latest chat-eval run into tasks.
//
//   node triage.mjs [--run reports/<ts>] [--dry-run]
//
// Lane 1 — engineering defects -> GitHub issues (deduplicated by fingerprint).
//   Needs GITHUB_TOKEN with repo scope; repo from CHAT_EVAL_REPO (owner/name).
//   Existing open issue with the same fingerprint gets a recurrence comment
//   instead of a duplicate.
// Lane 2 — operational signals + fleet scoreboard -> POST CHAT_EVAL_DIGEST_URL
//   (owner-digest / shre-health webhook). Skipped when unset.

import { readFileSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { buildTriage, renderIssueBody, renderRecurrenceComment, planIssueActions, buildDigestPayload } from './triage-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const runArg = args[args.indexOf('--run') + 1];
const REPO = process.env.CHAT_EVAL_REPO ?? 'Shreai/aros';
const TOKEN = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
const LABEL = 'chat-eval';

const runDir = args.includes('--run') && runArg
  ? runArg
  : (() => {
      const base = join(HERE, 'reports');
      const runs = readdirSync(base).sort();
      if (!runs.length) throw new Error('no runs under reports/');
      return join(base, runs[runs.length - 1]);
    })();

const summary = JSON.parse(readFileSync(join(runDir, 'summary.json'), 'utf8'));
const rows = readFileSync(join(runDir, 'results.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const runMeta = { when: summary.when, base: summary.base };
const { issues, operational } = buildTriage(rows);

async function gh(path, init = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`github ${path}: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

// Lane 1: issues
if (!issues.length) {
  console.log('[triage] no engineering defects this run');
} else if (!TOKEN) {
  console.warn(`[triage] GITHUB_TOKEN not set — skipping issue lane (${issues.length} intents)`);
} else {
  const openIssues = await gh(`/repos/${REPO}/issues?labels=${LABEL}&state=open&per_page=100`);
  const actions = planIssueActions(issues, openIssues);
  for (const a of actions) {
    if (a.action === 'create') {
      if (DRY) { console.log(`[triage] would CREATE: ${a.intent.title}`); continue; }
      const created = await gh(`/repos/${REPO}/issues`, {
        method: 'POST',
        body: JSON.stringify({ title: a.intent.title, body: renderIssueBody(a.intent, runMeta), labels: [LABEL, `${LABEL}:${a.intent.family}`] }),
      });
      console.log(`[triage] created #${created.number}: ${a.intent.title}`);
    } else {
      if (DRY) { console.log(`[triage] would COMMENT on #${a.number}: ${a.intent.fingerprint}`); continue; }
      await gh(`/repos/${REPO}/issues/${a.number}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body: renderRecurrenceComment(a.intent, runMeta) }),
      });
      console.log(`[triage] recurrence noted on #${a.number} (${a.intent.fingerprint})`);
    }
  }
}

// Lane 2: digest webhook
const digestUrl = process.env.CHAT_EVAL_DIGEST_URL;
if (digestUrl) {
  const payload = buildDigestPayload({ summary, operational, runMeta });
  if (DRY) {
    console.log(`[triage] would POST digest to ${digestUrl}: ${JSON.stringify(payload).slice(0, 300)}...`);
  } else {
    const res = await fetch(digestUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(process.env.CHAT_EVAL_DIGEST_TOKEN ? { Authorization: `Bearer ${process.env.CHAT_EVAL_DIGEST_TOKEN}` } : {}) },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });
    console.log(`[triage] digest POST -> HTTP ${res.status}`);
  }
} else {
  console.log('[triage] CHAT_EVAL_DIGEST_URL not set — digest lane skipped');
}

console.log(`[triage] done: ${issues.length} defect intents, ${operational.length} operational signals, run ${runDir}`);
