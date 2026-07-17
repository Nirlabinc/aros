#!/usr/bin/env node
// Golden-path E2E for docs/journeys/customer-orders-through-their-assistant.md
// Drives /api/public/businesses/{slug}/* the way a stranger's assistant would:
// no seeded client state, only what responses say. Asserts grounding (envelope
// on every response), the sensitive-column rule (no cost / exact stock ever),
// honest refusals, and the draft-only checkout note.
//
// Usage: node scripts/customer-commerce-e2e.mjs --base http://localhost:5457 [--slug demo-market]

const args = process.argv.slice(2);
const arg = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
const BASE = (arg('base', 'http://localhost:5457')).replace(/\/$/, '');
const SLUG = arg('slug', 'demo-market');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (cond) console.log(`  PASS  ${label}`);
  else { failures += 1; console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
};

const FORBIDDEN_KEYS = /"(unit_cost|units_on_hand|inventory_value|cost|margin)"\s*:/;

async function call(path, init) {
  const res = await fetch(`${BASE}/api/public/businesses/${path}`, init);
  const text = await res.text();
  let body = null; try { body = JSON.parse(text); } catch { /* asserted below */ }
  return { status: res.status, body, text };
}

function assertEnvelope(r, label) {
  ok(r.body && typeof r.body === 'object', `${label}: JSON body`);
  if (!r.body) return;
  ok(r.body.businessSlug === SLUG, `${label}: envelope.businessSlug`);
  ok(r.body.channel === 'customer', `${label}: envelope.channel`);
  ok(['public_projection', 'synthetic_demo'].includes(r.body.source), `${label}: envelope.source`);
  ok(typeof r.body.asOf === 'string', `${label}: envelope.asOf`);
  ok(typeof r.body.correlationId === 'string', `${label}: envelope.correlationId`);
  ok(!FORBIDDEN_KEYS.test(r.text), `${label}: no sensitive columns leak`, 'found forbidden key in payload');
}

console.log(`Customer commerce E2E against ${BASE} (slug: ${SLUG})\n`);

// 1. Deals — the journey's opening question
let r = await call(`${SLUG}/promotions`);
assertEnvelope(r, 'promotions');
ok(r.status === 200, 'promotions: 200');
ok(Array.isArray(r.body?.promotions), 'promotions: array');
if (Array.isArray(r.body?.promotions) && r.body.promotions.length > 0) {
  ok(r.body.promotions.every((p) => typeof p.sponsored === 'boolean'), 'promotions: sponsored flag machine-readable on every offer');
}

// 2. Product search — real answer with quantized availability
r = await call(`${SLUG}/products?q=coffee&limit=5`);
assertEnvelope(r, 'products');
ok(r.status === 200, 'products: 200');
const prod = r.body?.products?.[0];
ok(Boolean(prod && prod.sku && typeof prod.price === 'number'), 'products: sku + numeric price');
ok(['in_stock', 'low_stock', 'unavailable', 'unknown'].includes(prod?.availability), 'products: availability quantized');

// 3. Hours — real hours, or an honest refusal (both acceptable; invention is not)
r = await call(`${SLUG}/hours`);
assertEnvelope(r, 'hours');
ok(r.status === 200 || (r.status === 404 && r.body?.refusal?.code === 'hours_not_published'), 'hours: real answer or honest refusal');

// 4. Cart draft — priced server-side, draft-only stated
r = await call(`${SLUG}/cart`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ items: [{ sku: prod?.sku ?? 'COF-LG', qty: 1 }, { sku: 'BAN-01', qty: 1 }] }),
});
assertEnvelope(r, 'cart');
ok(r.status === 201, 'cart: 201 created');
const cartId = r.body?.cart?.cartId;
ok(typeof cartId === 'string', 'cart: cartId returned');
ok(typeof r.body?.cart?.subtotal === 'number', 'cart: server-side subtotal');
ok(/draft/i.test(String(r.body?.note ?? '')), 'cart: draft-only honestly stated');

// 5. Checkout draft — honest about payment not being enabled
r = await call(`${SLUG}/checkout`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ cartId }),
});
assertEnvelope(r, 'checkout');
ok(r.status === 200, 'checkout: 200');
ok(r.body?.checkout?.payment === 'not_enabled_in_phase_1', 'checkout: payment honesty flag');

// Failure-state assertions (journey table)
r = await call(`definitely-not-a-store/products`);
ok(r.status === 404 && r.body?.refusal?.code === 'unknown_business', 'unknown business: structured refusal, no invention');

r = await call(`${SLUG}/products?q=zzz-nonexistent-item-zzz`);
ok(r.status === 404 && r.body?.refusal?.code === 'no_matching_products', 'unknown item: refusal, not a guess');

r = await call(`${SLUG}/cart`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [{ sku: 'NOPE-404', qty: 1 }] }) });
ok(r.status === 404 && r.body?.refusal?.code === 'unknown_items', 'cart with unknown sku: refusal');

console.log(failures === 0 ? '\nALL PASS — golden path grounded end to end.' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
