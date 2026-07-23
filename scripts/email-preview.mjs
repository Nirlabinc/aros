/**
 * Render every AROS notification email with realistic sample data so the
 * founder can review the real output before anything is wired to a sender.
 *
 * Run:  npx tsx scripts/email-preview.mjs
 *       (tsx is required — this script imports the TypeScript template module
 *        directly so the previews are the exact bytes production will send.)
 *
 * Writes:  docs/email-previews/<slug>.light.html
 *          docs/email-previews/<slug>.dark.html
 *          docs/email-previews/index.html   ← the combined review page
 *
 * Nothing here is imported by the server; this is a build-time preview tool.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  renderEmail,
  renderNotificationEmail,
  voidAlertEmail,
  voidAlertTestEmail,
  weeklyBriefEmail,
  dailySalesEmail,
  lowStockEmail,
  connectorHealthEmail,
  teamChangeEmail,
} from '../src/email-templates.ts';
import { AROS_BRAND } from '../src/email-brand.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, '..', 'docs', 'email-previews');

// ── Sample data: a real store, real-looking figures ───────────────────────

const STORE = 'Party Liquor';

const WEEKLY_DIGEST = {
  provider: 'rapidrms',
  store_id: 'client-2',
  period_end: '2026-07-20',
  cadence: 'weekly',
  digest: {
    period: { end: '2026-07-20', window_days: 7 },
    reorder: [
      { upc: '018200069918', name: 'MICHELOB ULTRA 12 CAN', qty_on_hand: 0, stock_status: 'out_of_stock', suggested_qty: 23, est_reorder_cost: 316.71 },
      { upc: '619947000020', name: 'TITOS HANDMADE VODKA 750', qty_on_hand: 3, stock_status: 'low', suggested_qty: 12, est_reorder_cost: 198.00 },
      { upc: '083664872671', name: 'JAMESON IRISH WHISKEY 750', qty_on_hand: 2, stock_status: 'low', suggested_qty: 9, est_reorder_cost: 171.45 },
      { upc: '087000007048', name: 'CROWN ROYAL 1.75', qty_on_hand: 1, stock_status: 'low', suggested_qty: 6, est_reorder_cost: 233.94 },
      { upc: '080660955896', name: 'DON JULIO BLANCO 750', qty_on_hand: 0, stock_status: 'out_of_stock', suggested_qty: 6, est_reorder_cost: 264.00 },
    ],
    attach: [
      { lift: 448.2, name_a: 'LIBERTY CREEK MOSCATO 1.5', name_b: 'LIBERTY CREEK PINOT NOIR 1.5', together: 33, attach_rate: 0.917 },
      { lift: 121.4, name_a: 'MODELO ESPECIAL 12 CAN', name_b: 'TAKIS FUEGO 4OZ', together: 41, attach_rate: 0.412 },
      { lift: 88.6, name_a: 'WHITE CLAW VARIETY 12', name_b: 'ICE 10LB BAG', together: 27, attach_rate: 0.308 },
    ],
    notes: [],
  },
};

const LOW_STOCK_ITEMS = [
  { name: 'TITOS HANDMADE VODKA 750', current: 3, threshold: 12 },
  { name: 'MODELO ESPECIAL 12 CAN', current: 2, threshold: 10 },
  { name: 'MARLBORO GOLD BOX', current: 1, threshold: 8 },
  { name: 'RED BULL 12OZ 4PK', current: 4, threshold: 15 },
  { name: 'ICE 10LB BAG', current: 6, threshold: 24 },
];

/** A specimen email whose only job is to show the type system on one page. */
const TYPE_SPECIMEN = {
  title: 'The type system, on one page',
  eyebrow: 'Specimen',
  preheader: 'Display 32 · Title 24 · Section 20 · Lead 17 · Body 15 · Label 13.',
  accent: 'accent',
  titleScale: 'display',
  contextLabel: 'Party Liquor',
  blocks: [
    { kind: 'paragraph', size: 'lead', text: 'Lead, 17px sans at 26px line-height with a hair of negative tracking. One sentence, the one that matters, sitting directly under the serif title.' },
    { kind: 'paragraph', text: 'Body, 15px sans at 24px — roughly 1.6 — held to about sixty-six characters a line by forty pixels of card padding. Hierarchy comes from weight, colour and space rather than size, so supporting copy recedes without shrinking.' },
    { kind: 'divider' },
    { kind: 'heading', text: 'The hero metric', eyebrow: 'Section heading, 20px serif' },
    { kind: 'metricRow', items: [{ label: 'Void amount', value: '$42.00', caption: 'Tabular serif, 32px, −0.02em' }] },
    { kind: 'metricRow', items: [
      { label: 'Transactions', value: '128' },
      { label: 'Average ticket', value: '$21.44' },
      { label: 'Refunds', value: '3' },
    ] },
    { kind: 'divider' },
    { kind: 'heading', text: 'Ledger rows', eyebrow: 'Mono, tabular figures' },
    { kind: 'keyValue', rows: [
      { label: 'Store', value: 'Party Liquor' },
      { label: 'Invoice', value: 'INV-4482', mono: true },
      { label: 'Time', value: 'Jul 22, 2026 · 9:41 PM', mono: true },
      { label: 'Amount', value: '$42.00', mono: true },
    ] },
    { kind: 'list', items: [
      { text: 'List items carry an ink label and a muted mono detail', detail: '3 / 12' },
      { text: 'The detail column right-aligns so figures form a column', detail: '128 / 240' },
    ], more: '…and a muted overflow line' },
    { kind: 'callout', tone: 'accent', eyebrow: 'Callout', title: 'A tinted panel for the one fact', lines: ['Three-pixel accent rule on the left, cream panel, hairline border.'] },
    { kind: 'cta', label: 'Bulletproof button', href: 'https://app.aros.live/dashboard' },
    { kind: 'note', text: 'Note, 13px muted — disclaimers, units, and the quiet print.' },
  ],
};

// ── Build every sample ────────────────────────────────────────────────────

const VOID_FACTS = {
  storeName: STORE,
  invoiceNo: 'INV-4482',
  amount: 42.0,
  timestamp: 'Jul 22, 2026 · 9:41 PM',
  businessDate: '2026-07-22',
  cashier: 'Ravi P.',
};

const FALLBACK_TEXT = [
  'Your monthly margin report finished generating for Party Liquor.',
  '',
  'Revenue: $128,440.10',
  'Margin: 24.8%',
  'Exceptions: 3',
  '',
  'Open the report: https://app.aros.live/dashboard',
].join('\n');

/** Every sample renders through `build(options)` so the dark variant is the
 *  real renderer with `forceDark`, not a post-hoc string edit. */
const samples = [
  {
    slug: 'type-specimen',
    name: 'Type specimen',
    note: 'Not a notification — every typographic role in the system, on one card.',
    height: 1620,
    build: (o) => ({ subject: '(specimen — not sent)', ...renderEmail(TYPE_SPECIMEN, AROS_BRAND, o) }),
  },
  {
    slug: 'void-alert',
    name: 'Void alert (real)',
    note: 'event: void-alert · structured builder · calm-urgent alert hairline',
    height: 1020,
    build: (o) => voidAlertEmail(VOID_FACTS, AROS_BRAND, o),
  },
  {
    slug: 'void-alert-test',
    name: 'Void alert (TEST fire)',
    note: 'event: void-alert · muted TEST band, deliberately unalarming',
    height: 1000,
    build: (o) => voidAlertTestEmail(STORE, 'email', AROS_BRAND, o),
  },
  {
    slug: 'weekly-brief',
    name: 'Weekly brief',
    note: 'event: weekly-brief · consumes the existing owner-digest payload',
    height: 1880,
    build: (o) => weeklyBriefEmail(STORE, WEEKLY_DIGEST, AROS_BRAND, o),
  },
  {
    slug: 'daily-sales',
    name: 'Daily sales summary',
    note: 'event: daily-sales-summary · revenue is the typographic hero',
    height: 1000,
    build: (o) => dailySalesEmail(STORE, '2026-07-22', { revenue: 4218.75, transactions: 197 }, AROS_BRAND, o),
  },
  {
    slug: 'low-stock',
    name: 'Low stock',
    note: 'event: low-stock · count as hero, items as a mono-detail list',
    height: 1240,
    build: (o) => lowStockEmail(STORE, LOW_STOCK_ITEMS, AROS_BRAND, o),
  },
  {
    slug: 'connector-health',
    name: 'Connection issue',
    note: 'event: connector-health · alert callout + ledger of facts',
    height: 1180,
    build: (o) => connectorHealthEmail({
      storeName: STORE,
      connectorLabel: 'RapidRMS',
      issue: 'The last three sync attempts were rejected: the store credentials are no longer accepted.',
      detectedAt: 'Jul 22, 2026 · 6:12 AM',
      lastSyncAt: 'Jul 21, 2026 · 11:47 PM',
    }, AROS_BRAND, o),
  },
  {
    slug: 'team-change',
    name: 'Team change',
    note: 'event: team-changes · membership facts as a ledger',
    height: 960,
    build: (o) => teamChangeEmail({
      action: 'invited',
      summary: 'ravi@partyliquor.com was invited to the workspace as an admin.',
      workspaceName: 'Party Liquor',
      personEmail: 'ravi@partyliquor.com',
      role: 'admin',
    }, AROS_BRAND, o),
  },
  {
    slug: 'fallback-generic',
    name: 'Fallback (unmapped event)',
    note: 'renderNotificationEmail() on an event with no bespoke template — the never-regress path',
    height: 980,
    build: (o) => ({
      subject: 'Your AROS report is ready',
      ...renderNotificationEmail('some-future-event', 'Your AROS report is ready', FALLBACK_TEXT, AROS_BRAND, o),
    }),
  },
];

// ── Emit ──────────────────────────────────────────────────────────────────

mkdirSync(OUT_DIR, { recursive: true });

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const cards = [];
const rail = [];
for (const sample of samples) {
  const light = sample.build({});
  const dark = sample.build({ forceDark: true });
  if (!light || !dark) {
    console.error(`[email-preview] ${sample.slug} produced no email — skipped`);
    continue;
  }
  writeFileSync(join(OUT_DIR, `${sample.slug}.light.html`), light.html, 'utf8');
  writeFileSync(join(OUT_DIR, `${sample.slug}.dark.html`), dark.html, 'utf8');
  cards.push(card(sample, light));
  rail.push(`<li><a href="#${sample.slug}">${esc(sample.name)}</a></li>`);
  console.log(`[email-preview] ${sample.slug}`);
}

function card(sample, built) {
  return `<section class="card" id="${sample.slug}">
  <header class="card-head">
    <h2>${esc(sample.name)}</h2>
    <p class="meta">${esc(sample.note)}</p>
    <dl class="kv">
      <div><dt>Subject</dt><dd>${esc(built.subject)}</dd></div>
      <div><dt>Preheader</dt><dd>${esc(previewPreheader(built.html))}</dd></div>
    </dl>
  </header>
  <div class="frames">
    <figure><figcaption>Light</figcaption><iframe src="./${sample.slug}.light.html" style="height:${sample.height}px" title="${esc(sample.name)} — light"></iframe></figure>
    <figure><figcaption>Dark</figcaption><iframe src="./${sample.slug}.dark.html" style="height:${sample.height}px" title="${esc(sample.name)} — dark"></iframe></figure>
  </div>
  <details>
    <summary>Plain-text alternative (what text clients and spam filters read)</summary>
    <pre>${esc(built.text)}</pre>
  </details>
</section>`;
}

function previewPreheader(html) {
  const m = /class="em-preheader"[^>]*>([\s\S]*?)&#847;/.exec(html);
  return m ? m[1] : '(none)';
}

const index = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>AROS notification emails — preview</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin:0; background:#F4F1EB; color:#1A1714;
    font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; }
  .page { max-width:1360px; margin:0 auto; padding:56px 24px 96px; }
  .lede { max-width:660px; }
  .mark { display:inline-block; width:8px; height:8px; border-radius:2px; background:#B8842A; margin-right:10px; vertical-align:middle; }
  h1 { font-family:Newsreader, 'Iowan Old Style', Georgia, serif; font-size:38px; line-height:44px;
       letter-spacing:-0.02em; font-weight:600; margin:0 0 12px; }
  .lede p { font-size:17px; line-height:27px; color:#4A443C; margin:0 0 10px; }
  .rail { display:flex; gap:8px; flex-wrap:wrap; margin:28px 0 0; padding:0; list-style:none; }
  .rail a { display:inline-block; padding:7px 13px; border:1px solid #DFD8CB; border-radius:999px;
            background:#FFF; color:#5A5248; text-decoration:none; font-size:13px; font-weight:600; }
  .rail a:hover { border-color:#B8842A; color:#8A6318; }
  .card { margin:56px 0 0; padding:28px 28px 20px; background:#FFF; border:1px solid #E4DDD1; border-radius:16px; }
  .card-head h2 { font-family:Newsreader, 'Iowan Old Style', Georgia, serif; font-size:24px; line-height:30px;
                  letter-spacing:-0.015em; font-weight:600; margin:0 0 6px; }
  .meta { margin:0 0 16px; font-size:13px; line-height:20px; color:#8A8175;
          font-family:'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace; }
  .kv { display:grid; gap:8px; margin:0 0 22px; padding:16px 18px; background:#FBF9F5;
        border:1px solid #EDE7DC; border-radius:10px; }
  .kv > div { display:grid; grid-template-columns:110px 1fr; gap:12px; }
  .kv dt { margin:0; font-size:11px; letter-spacing:0.08em; text-transform:uppercase; font-weight:700; color:#8A8175; padding-top:2px; }
  .kv dd { margin:0; font-size:14px; line-height:20px; color:#2E2A25; }
  .frames { display:grid; grid-template-columns:1fr 1fr; gap:20px; }
  @media (max-width:1000px) { .frames { grid-template-columns:1fr; } }
  figure { margin:0; }
  figcaption { font-size:11px; letter-spacing:0.08em; text-transform:uppercase; font-weight:700;
               color:#8A8175; margin:0 0 8px; }
  iframe { width:100%; border:1px solid #E4DDD1; border-radius:12px; background:#FBF9F5; display:block; }
  details { margin:20px 0 0; }
  summary { cursor:pointer; font-size:13px; font-weight:600; color:#8A6318; padding:8px 0; }
  pre { margin:8px 0 0; padding:20px; background:#1E1B17; color:#E6DFD3; border-radius:10px;
        overflow-x:auto; font-family:'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size:12.5px; line-height:20px; white-space:pre-wrap; }
  footer { margin:64px 0 0; font-size:13px; line-height:20px; color:#8A8175; }
</style>
</head>
<body>
<div class="page">
  <div class="lede">
    <h1><span class="mark"></span>AROS notification emails</h1>
    <p>Every notification lane, rendered from the same shell with realistic Party Liquor data. Light and dark are shown side by side; the dark frames have the <code>prefers-color-scheme</code> wrapper unwrapped so they render regardless of your OS setting.</p>
    <p>Each card also shows the subject, the hidden preheader that controls the inbox snippet, and the plain-text alternative that ships alongside every HTML send.</p>
  </div>
  <ul class="rail">${rail.join('')}</ul>
${cards.join('\n')}
  <footer>Generated by <code>scripts/email-preview.mjs</code> — <code>npx tsx scripts/email-preview.mjs</code>. Templates: <code>src/email-templates.ts</code>.</footer>
</div>
</body>
</html>`;

writeFileSync(join(OUT_DIR, 'index.html'), index, 'utf8');
console.log(`[email-preview] wrote ${cards.length} previews → ${join(OUT_DIR, 'index.html')}`);
