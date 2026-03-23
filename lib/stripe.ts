/**
 * Server-side Stripe client configuration.
 *
 * Two clients are exported:
 *
 * 1. `stripe` — Clover beta client for ALL CPM-related operations:
 *    paymentRecords.reportPayment, paymentMethods.create({ type: 'custom' }),
 *    paymentMethods.attach, subscriptions.update (default_payment_method),
 *    invoices.attachPayment, invoices.retrieve/update/pay, customers.retrieve.
 *    Per Stripe docs, all third-party payment processing ops use the clover API version.
 *
 * 2. `stripeStandard` — Standard API client for subscription/invoice CREATION
 *    (create-subscription route) and non-CPM operations like complete-stripe-payment.
 *
 * @see https://docs.stripe.com/custom-payment-methods
 * @see https://docs.stripe.com/billing/subscriptions/third-party-payment-processing
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new Stripe(resolveSecretKey(), { apiVersion: '2024-12-18.acacia' as any });
}

/**
 * Clover beta client — for ALL CPM-related operations (payment records,
 * custom payment methods, invoices.attachPayment, etc.).
 */
export const stripe = new Proxy({} as Stripe, {
  get(_target, prop) {
    return getStripeCloverClient()[prop as keyof Stripe];
  },
});

/**
 * Standard Stripe client — for subscription/invoice CREATION and non-CPM operations.
 * Uses the stable API version.
 */
export const stripeStandard = new Proxy({} as Stripe, {
  get(_target, prop) {
    return getStripeStandardClient()[prop as keyof Stripe];
  },
});
