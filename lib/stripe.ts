/**
 * Server-side Stripe client configuration.
 *
 * Two clients are exported:
 *
 * 1. `stripe` — Clover beta client for Payment Records API only
 *    (stripe.paymentRecords.reportPayment). Do NOT use for subscriptions,
 *    invoices, customers, or PaymentIntents — the beta API version can
 *    break invoice-PI linkage.
 *
 * 2. `stripeStandard` — Standard API client for everything else:
 *    subscriptions, invoices, customers, PaymentIntents.
 *
 * @see https://docs.stripe.com/custom-payment-methods
 * @see https://docs.stripe.com/api/payment-records
 */
import Stripe from 'stripe';

function resolveSecretKey(): string {
  const stripeEnv = process.env.NEXT_PUBLIC_HITPAY_ENV || 'sandbox';
  const key =
    stripeEnv === 'production' ? process.env.STRIPE_SECRET_KEY_PRODUCTION
    : stripeEnv === 'staging'  ? process.env.STRIPE_SECRET_KEY_STAGING
    : process.env.STRIPE_SECRET_KEY_SANDBOX;

  if (!key) {
    throw new Error(
      `STRIPE_SECRET_KEY_${stripeEnv.toUpperCase()} is not set. Please configure it in your .env.local file.\n` +
        'Get your secret key from: https://dashboard.stripe.com/apikeys'
    );
  }
  return key;
}

function getStripeCloverClient() {
  // @ts-expect-error - Beta API version for Payment Records (stripe.paymentRecords.reportPayment)
  return new Stripe(resolveSecretKey(), { apiVersion: '2025-12-15.clover', typescript: true });
}

function getStripeStandardClient() {
  return new Stripe(resolveSecretKey(), { apiVersion: '2024-12-18.acacia' });
}

/**
 * Clover beta client — ONLY for stripe.paymentRecords.reportPayment().
 * Do not use for subscriptions, invoices, or PaymentIntents.
 */
export const stripe = new Proxy({} as Stripe, {
  get(_target, prop) {
    return getStripeCloverClient()[prop as keyof Stripe];
  },
});

/**
 * Standard Stripe client — for subscriptions, invoices, customers, PaymentIntents.
 * Uses the stable API version so invoice-PI linkage works correctly.
 */
export const stripeStandard = new Proxy({} as Stripe, {
  get(_target, prop) {
    return getStripeStandardClient()[prop as keyof Stripe];
  },
});
