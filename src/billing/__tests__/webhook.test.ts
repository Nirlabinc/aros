/**
 * AROS Platform — Stripe Webhook Handler Integration Tests
 *
 * Tests all billing event paths without hitting real Stripe or Supabase.
 * Signature verification uses the real Stripe SDK crypto path with a
 * local test secret, so the crypto code is exercised (not mocked).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import Stripe from 'stripe';
import { handleStripeWebhook, _resetProcessedEvents } from '../webhook.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const TEST_WEBHOOK_SECRET = 'whsec_test_0000000000000000000000000000000000000000000000000000000000000000';
const TEST_STRIPE_KEY = 'sk_test_placeholder';
const TEST_TENANT_ID = 'tenant-abc-123';
const TEST_CUSTOMER_ID = 'cus_test_abc123';
const TEST_SUBSCRIPTION_ID = 'sub_test_abc123';
const TEST_PRICE_PRO = 'price_pro_test';
const TEST_PRICE_STARTER = 'price_starter_test';

// ── Supabase mock ─────────────────────────────────────────────────────────────
//
// We capture every .update().eq() call so tests can assert the final
// state the handler tried to write, and count calls for idempotency checks.

interface CapturedUpdate {
  table: string;
  fields: Record<string, unknown>;
  column: string;
  value: unknown;
}

let capturedUpdates: CapturedUpdate[] = [];

vi.mock('../../supabase.js', () => {
  const makeEq = (table: string, fields: Record<string, unknown>) => ({
    eq: (column: string, value: unknown) => {
      capturedUpdates.push({ table, fields, column, value });
      return Promise.resolve({ data: null, error: null });
    },
  });

  const makeFrom = () => ({
    update: (fields: Record<string, unknown>) => ({
      eq: (column: string, value: unknown) => {
        // Capture which table via closure below
        capturedUpdates.push({ table: '__unknown__', fields, column, value });
        return Promise.resolve({ data: null, error: null });
      },
    }),
  });

  // We need to capture the table name, so build a smarter mock
  const fromFn = (table: string) => ({
    update: (fields: Record<string, unknown>) => makeEq(table, fields),
    insert: (rows: unknown) => ({
      select: () => Promise.resolve({ data: rows, error: null }),
    }),
  });

  return {
    createSupabaseAdmin: () => ({ from: fromFn }),
  };
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Generate a valid Stripe-signature header for a payload using the test secret. */
function makeSignature(payload: string): string {
  // Use Stripe's own test helper so real HMAC code is exercised
  return (Stripe as unknown as { webhooks: { generateTestHeaderString: (opts: { payload: string; secret: string }) => string } })
    .webhooks.generateTestHeaderString({ payload, secret: TEST_WEBHOOK_SECRET });
}

/** Serialize a fixture event and return [payload, signature] pair. */
function fixture(event: Record<string, unknown>): [string, string] {
  const payload = JSON.stringify(event);
  return [payload, makeSignature(payload)];
}

/** Minimal Stripe event envelope. */
function makeEvent(
  id: string,
  type: string,
  obj: Record<string, unknown>,
): Record<string, unknown> {
  return {
    id,
    object: 'event',
    api_version: '2024-12-18.acacia',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type,
    data: { object: obj },
  };
}

function makeSubscription(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: TEST_SUBSCRIPTION_ID,
    object: 'subscription',
    status: 'active',
    cancel_at_period_end: false,
    current_period_end: Math.floor(Date.now() / 1000) + 2592000,
    metadata: { tenant_id: TEST_TENANT_ID },
    items: {
      object: 'list',
      data: [
        {
          id: 'si_test',
          object: 'subscription_item',
          price: { id: TEST_PRICE_PRO, object: 'price' },
        },
      ],
    },
    ...overrides,
  };
}

// ── Environment setup ─────────────────────────────────────────────────────────

beforeEach(() => {
  capturedUpdates = [];
  _resetProcessedEvents();
  process.env['STRIPE_SECRET_KEY'] = TEST_STRIPE_KEY;
  process.env['STRIPE_WEBHOOK_SECRET'] = TEST_WEBHOOK_SECRET;
  process.env['STRIPE_PRICE_PRO'] = TEST_PRICE_PRO;
  process.env['STRIPE_PRICE_STARTER'] = TEST_PRICE_STARTER;
  process.env['STRIPE_PRICE_ENTERPRISE'] = 'price_enterprise_test';
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('handleStripeWebhook — signature verification', () => {
  it('rejects a bad signature with status 400', async () => {
    const payload = JSON.stringify(makeEvent('evt_bad', 'checkout.session.completed', {}));
    const result = await handleStripeWebhook(payload, 'v1=badhex');
    expect(result.status).toBe(400);
    expect(result.body).toHaveProperty('error');
    expect(String(result.body['error'])).toContain('signature');
  });

  it('rejects a signature for a different secret', async () => {
    const payload = JSON.stringify(makeEvent('evt_wrongsecret', 'checkout.session.completed', {}));
    const wrongSecret = 'whsec_wrong000000000000000000000000000000000000000000000000000000000000';
    const wrongSig = (Stripe as unknown as { webhooks: { generateTestHeaderString: (opts: { payload: string; secret: string }) => string } })
      .webhooks.generateTestHeaderString({ payload, secret: wrongSecret });
    const result = await handleStripeWebhook(payload, wrongSig);
    expect(result.status).toBe(400);
  });
});

describe('handleStripeWebhook — checkout.session.completed (regression)', () => {
  it('activates subscription and sets billing_status to active', async () => {
    const sessionObj = {
      id: 'cs_test_001',
      object: 'checkout.session',
      mode: 'subscription',
      customer: TEST_CUSTOMER_ID,
      subscription: TEST_SUBSCRIPTION_ID,
      metadata: { tenant_id: TEST_TENANT_ID, plan: 'pro' },
    };
    const [payload, sig] = fixture(makeEvent('evt_checkout_001', 'checkout.session.completed', sessionObj));

    const result = await handleStripeWebhook(payload, sig);

    expect(result.status).toBe(200);
    expect(capturedUpdates).toHaveLength(1);
    const update = capturedUpdates[0];
    expect(update.table).toBe('tenants');
    expect(update.column).toBe('id');
    expect(update.value).toBe(TEST_TENANT_ID);
    expect(update.fields['billing_status']).toBe('active');
    expect(update.fields['plan']).toBe('pro');
    expect(update.fields['stripe_customer_id']).toBe(TEST_CUSTOMER_ID);
    expect(update.fields['stripe_subscription_id']).toBe(TEST_SUBSCRIPTION_ID);
  });
});

describe('handleStripeWebhook — invoice.payment_failed', () => {
  it('sets billing_status to past_due on the matching tenant', async () => {
    const invoiceObj = {
      id: 'in_test_001',
      object: 'invoice',
      customer: TEST_CUSTOMER_ID,
      amount_due: 2900,
      amount_paid: 0,
      status: 'open',
    };
    const [payload, sig] = fixture(makeEvent('evt_payfail_001', 'invoice.payment_failed', invoiceObj));

    const result = await handleStripeWebhook(payload, sig);

    expect(result.status).toBe(200);
    expect(capturedUpdates).toHaveLength(1);
    const update = capturedUpdates[0];
    expect(update.table).toBe('tenants');
    expect(update.column).toBe('stripe_customer_id');
    expect(update.value).toBe(TEST_CUSTOMER_ID);
    expect(update.fields['billing_status']).toBe('past_due');
  });
});

describe('handleStripeWebhook — customer.subscription.updated (plan upgrade)', () => {
  it('reflects new plan on the tenant when price ID maps to a known plan', async () => {
    const subscriptionObj = makeSubscription({
      status: 'active',
      cancel_at_period_end: false,
      items: {
        object: 'list',
        data: [{ id: 'si_test', object: 'subscription_item', price: { id: TEST_PRICE_PRO, object: 'price' } }],
      },
    });
    const [payload, sig] = fixture(makeEvent('evt_upgrade_001', 'customer.subscription.updated', subscriptionObj));

    const result = await handleStripeWebhook(payload, sig);

    expect(result.status).toBe(200);
    expect(capturedUpdates).toHaveLength(1);
    const update = capturedUpdates[0];
    expect(update.table).toBe('tenants');
    expect(update.column).toBe('id');
    expect(update.value).toBe(TEST_TENANT_ID);
    expect(update.fields['billing_status']).toBe('active');
    expect(update.fields['plan']).toBe('pro');
    expect(update.fields['license_tier']).toBe('pro');
  });

  it('downgrade: sets plan to starter when price maps to starter', async () => {
    const subscriptionObj = makeSubscription({
      status: 'active',
      cancel_at_period_end: false,
      items: {
        object: 'list',
        data: [{ id: 'si_test', object: 'subscription_item', price: { id: TEST_PRICE_STARTER, object: 'price' } }],
      },
    });
    const [payload, sig] = fixture(makeEvent('evt_downgrade_001', 'customer.subscription.updated', subscriptionObj));

    const result = await handleStripeWebhook(payload, sig);

    expect(result.status).toBe(200);
    const update = capturedUpdates[0];
    expect(update.fields['plan']).toBe('starter');
    expect(update.fields['billing_status']).toBe('active');
  });

  it('cancel_at_period_end=true sets billing_status to canceled without deleting subscription', async () => {
    const subscriptionObj = makeSubscription({
      status: 'active',
      cancel_at_period_end: true,
    });
    const [payload, sig] = fixture(makeEvent('evt_cancel_period_001', 'customer.subscription.updated', subscriptionObj));

    const result = await handleStripeWebhook(payload, sig);

    expect(result.status).toBe(200);
    expect(capturedUpdates).toHaveLength(1);
    const update = capturedUpdates[0];
    expect(update.fields['billing_status']).toBe('canceled');
    // Plan and license_tier should still be set (subscription isn't gone yet)
    expect(update.fields['plan']).toBe('pro');
  });
});

describe('handleStripeWebhook — customer.subscription.deleted (hard cancel)', () => {
  it('sets billing_status=canceled, plan=free, and clears subscription ID', async () => {
    const subscriptionObj = makeSubscription({ status: 'canceled' });
    const [payload, sig] = fixture(makeEvent('evt_deleted_001', 'customer.subscription.deleted', subscriptionObj));

    const result = await handleStripeWebhook(payload, sig);

    expect(result.status).toBe(200);
    expect(capturedUpdates).toHaveLength(1);
    const update = capturedUpdates[0];
    expect(update.table).toBe('tenants');
    expect(update.column).toBe('id');
    expect(update.value).toBe(TEST_TENANT_ID);
    expect(update.fields['billing_status']).toBe('canceled');
    expect(update.fields['plan']).toBe('free');
    expect(update.fields['license_tier']).toBe('free');
    expect(update.fields['stripe_subscription_id']).toBeNull();
  });
});

describe('handleStripeWebhook — idempotency (no double-processing on replay)', () => {
  it('processes an event once, returns duplicate=true on second delivery, and makes no extra DB writes', async () => {
    const subscriptionObj = makeSubscription({ status: 'canceled' });
    const [payload, sig] = fixture(makeEvent('evt_idempotent_001', 'customer.subscription.deleted', subscriptionObj));

    // First delivery — should process normally
    const first = await handleStripeWebhook(payload, sig);
    expect(first.status).toBe(200);
    expect(first.body['duplicate']).toBeUndefined();
    expect(capturedUpdates).toHaveLength(1);

    // Second delivery (replay) — same event ID, same payload and signature
    const second = await handleStripeWebhook(payload, sig);
    expect(second.status).toBe(200);
    expect(second.body['duplicate']).toBe(true);
    // DB writes must NOT have increased — idempotent
    expect(capturedUpdates).toHaveLength(1);
  });

  it('processes different event IDs independently', async () => {
    const subscriptionObj = makeSubscription({ status: 'active', cancel_at_period_end: false });

    const [p1, s1] = fixture(makeEvent('evt_multi_001', 'customer.subscription.updated', subscriptionObj));
    const [p2, s2] = fixture(makeEvent('evt_multi_002', 'customer.subscription.updated', subscriptionObj));

    await handleStripeWebhook(p1, s1);
    await handleStripeWebhook(p2, s2);

    expect(capturedUpdates).toHaveLength(2);
  });
});
