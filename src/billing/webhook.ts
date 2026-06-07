/**
 * AROS Platform — Stripe Webhook Handler
 *
 * Processes Stripe events to keep tenant billing state in sync.
 * All DB writes go to Supabase via the admin client.
 */

import { constructWebhookEvent, planFromPriceId, type Stripe } from './stripe.js';
import { createSupabaseAdmin } from '../supabase.js';

export interface WebhookResult {
  status: number;
  body: Record<string, unknown>;
}

/**
 * In-process idempotency guard: tracks Stripe event IDs already handled in
 * this process lifetime. Prevents double-processing on webhook replay.
 * NOTE: A persistent store (e.g. stripe_billing_events table) would be needed
 * for cross-process idempotency across multiple replicas. This table does not
 * yet exist in the schema; a future migration should add it and replace this Set.
 */
const _processedEventIds = new Set<string>();

/** Exposed for test reset only — do not call in production code. */
export function _resetProcessedEvents(): void {
  _processedEventIds.clear();
}

/**
 * Process an incoming Stripe webhook request.
 * @param rawBody - Raw request body (must NOT be parsed as JSON)
 * @param signature - Value of the `stripe-signature` header
 */
export async function handleStripeWebhook(
  rawBody: string | Buffer,
  signature: string,
): Promise<WebhookResult> {
  // ── Verify signature ────────────────────────────────────────
  let event: Stripe.Event;
  try {
    event = constructWebhookEvent(rawBody, signature);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid signature';
    return { status: 400, body: { error: `Webhook signature verification failed: ${message}` } };
  }

  // ── Idempotency guard ───────────────────────────────────────
  if (_processedEventIds.has(event.id)) {
    return { status: 200, body: { received: true, type: event.type, duplicate: true } };
  }
  _processedEventIds.add(event.id);

  const supabase = createSupabaseAdmin();

  // ── Route by event type ─────────────────────────────────────
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const tenantId = session.metadata?.tenant_id;
      const plan = session.metadata?.plan || 'starter';

      if (tenantId && session.customer && session.subscription) {
        await supabase
          .from('tenants')
          .update({
            plan,
            license_tier: plan,
            stripe_customer_id: String(session.customer),
            stripe_subscription_id: String(session.subscription),
            billing_status: 'active',
            updated_at: new Date().toISOString(),
          })
          .eq('id', tenantId);
      }
      break;
    }

    case 'customer.subscription.updated': {
      const subscription = event.data.object as Stripe.Subscription;
      const tenantId = subscription.metadata?.tenant_id;
      const priceId = subscription.items.data[0]?.price?.id || '';
      const plan = planFromPriceId(priceId);

      if (tenantId) {
        // cancel_at_period_end=true means the subscription will cancel at period end
        let billingStatus: string;
        if (subscription.cancel_at_period_end) {
          billingStatus = 'canceled';
        } else if (subscription.status === 'active') {
          billingStatus = 'active';
        } else {
          billingStatus = subscription.status;
        }

        const updateFields: Record<string, unknown> = {
          billing_status: billingStatus,
          updated_at: new Date().toISOString(),
        };
        if (plan) {
          updateFields.plan = plan;
          updateFields.license_tier = plan;
        }
        await supabase.from('tenants').update(updateFields).eq('id', tenantId);
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription;
      const tenantId = subscription.metadata?.tenant_id;

      if (tenantId) {
        await supabase
          .from('tenants')
          .update({
            plan: 'free',
            license_tier: 'free',
            billing_status: 'canceled',
            stripe_subscription_id: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', tenantId);
      }
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId =
        typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;

      if (customerId) {
        await supabase
          .from('tenants')
          .update({
            billing_status: 'past_due',
            updated_at: new Date().toISOString(),
          })
          .eq('stripe_customer_id', customerId);
      }
      break;
    }

    case 'charge.succeeded': {
      const charge = event.data.object as Stripe.Charge;
      const tenantId = charge.metadata?.tenant_id;
      const amountUsd = (charge.amount ?? 0) / 100;
      if (tenantId && amountUsd > 0) {
        const meterUrl = process.env.SHRE_METER_URL ?? 'http://127.0.0.1:5495';
        await fetch(`${meterUrl}/v1/credit/${encodeURIComponent(tenantId)}/payment`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'recharge', amountUsd }),
          signal: AbortSignal.timeout(4000),
        }).catch(() => {});
      }
      break;
    }

    case 'invoice.payment_succeeded': {
      const invoice = event.data.object as Stripe.Invoice;
      const tenantId =
        typeof invoice.subscription_details?.metadata?.tenant_id === 'string'
          ? invoice.subscription_details.metadata.tenant_id
          : (invoice as unknown as { metadata?: { tenant_id?: string } }).metadata?.tenant_id;
      const amountUsd = (invoice.amount_paid ?? 0) / 100;
      if (tenantId && amountUsd > 0) {
        const meterUrl = process.env.SHRE_METER_URL ?? 'http://127.0.0.1:5495';
        await fetch(`${meterUrl}/v1/credit/${encodeURIComponent(tenantId)}/payment`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'recharge', amountUsd }),
          signal: AbortSignal.timeout(4000),
        }).catch(() => {});
      }
      break;
    }

    default:
      // Unhandled event type — acknowledge receipt
      break;
  }

  return { status: 200, body: { received: true, type: event.type } };
}
