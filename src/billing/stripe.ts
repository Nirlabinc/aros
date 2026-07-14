/**
 * AROS Platform — Stripe Billing Client
 *
 * Checkout sessions, portal sessions, subscription management.
 * All Stripe keys come from environment variables.
 */

import Stripe from 'stripe';

// ── Stripe client (lazy singleton) ──────────────────────────────

let _stripe: Stripe | null = null;

function getStripe(): Stripe {
  if (_stripe) return _stripe;

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error('Missing STRIPE_SECRET_KEY environment variable.');
  }

  _stripe = new Stripe(secretKey, { apiVersion: '2024-12-18.acacia' });
  return _stripe;
}

// ── Plan → Price ID mapping ─────────────────────────────────────

export type PlanId = 'starter' | 'pro' | 'enterprise';

/**
 * Plan → Price ID mapping, resolved at call time so runtime env changes
 * (and per-test overrides) are respected. Resolving lazily avoids the
 * module-load snapshot pitfall where env set after import is ignored.
 */
function planPrices(): Record<PlanId, string> {
  return {
    starter: process.env.STRIPE_PRICE_STARTER || '',
    pro: process.env.STRIPE_PRICE_PRO || '',
    enterprise: process.env.STRIPE_PRICE_ENTERPRISE || '',
  };
}

/** Reverse lookup: Stripe price ID → plan name */
export function planFromPriceId(priceId: string): PlanId | null {
  if (!priceId) return null;
  for (const [plan, id] of Object.entries(planPrices())) {
    if (id && id === priceId) return plan as PlanId;
  }
  return null;
}

// ── Checkout ────────────────────────────────────────────────────

export interface CheckoutOptions {
  tenantId: string;
  plan: PlanId;
  email: string;
  successUrl?: string;
  cancelUrl?: string;
}

/**
 * Create a Stripe Checkout Session for a new subscription.
 * Returns the checkout URL for redirect.
 */
export async function createCheckoutSession(opts: CheckoutOptions): Promise<string> {
  const stripe = getStripe();
  const priceId = planPrices()[opts.plan];

  if (!priceId) {
    throw new Error(`No Stripe price configured for plan: ${opts.plan}`);
  }

  const baseUrl = process.env.AROS_PUBLIC_URL || 'https://aros.nirtek.net';

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer_email: opts.email,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url:
      opts.successUrl || `${baseUrl}/onboarding?payment=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: opts.cancelUrl || `${baseUrl}/onboarding?payment=canceled`,
    metadata: {
      tenant_id: opts.tenantId,
      plan: opts.plan,
    },
    subscription_data: {
      metadata: {
        tenant_id: opts.tenantId,
        plan: opts.plan,
      },
    },
  });

  if (!session.url) {
    throw new Error('Stripe returned no checkout URL.');
  }

  return session.url;
}

// ── Billing Portal ──────────────────────────────────────────────

/**
 * Create a Stripe Customer Portal session.
 * Returns the portal URL for redirect.
 */
export async function createPortalSession(stripeCustomerId: string): Promise<string> {
  const stripe = getStripe();
  const baseUrl = process.env.AROS_PUBLIC_URL || 'https://aros.nirtek.net';

  const session = await stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: `${baseUrl}/billing`,
  });

  return session.url;
}

// ── Subscription Info ───────────────────────────────────────────

export interface SubscriptionStatus {
  id: string;
  status: string;
  plan: PlanId | null;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
}

/**
 * Retrieve subscription details from Stripe.
 */
export async function getSubscription(subscriptionId: string): Promise<SubscriptionStatus> {
  const stripe = getStripe();
  const sub = await stripe.subscriptions.retrieve(subscriptionId);

  const priceId = sub.items.data[0]?.price?.id || '';

  return {
    id: sub.id,
    status: sub.status,
    plan: planFromPriceId(priceId),
    currentPeriodEnd: new Date(sub.current_period_end * 1000).toISOString(),
    cancelAtPeriodEnd: sub.cancel_at_period_end,
  };
}

// ── Webhook Signature Verification ──────────────────────────────

/**
 * Verify and parse a Stripe webhook event from raw body + signature header.
 */
export function constructWebhookEvent(rawBody: string | Buffer, signature: string): Stripe.Event {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secret) {
    throw new Error('Missing STRIPE_WEBHOOK_SECRET environment variable.');
  }

  return stripe.webhooks.constructEvent(rawBody, signature, secret);
}

/** Re-export Stripe types for consumers */
export type { Stripe };
