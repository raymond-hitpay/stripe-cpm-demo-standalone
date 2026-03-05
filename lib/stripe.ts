/**
 * Server-side Stripe client configuration.
 *
 * This client is configured with the Payment Records beta API version,
 * which is required for recording external payments from custom payment
 * method integrations (like HitPay PayNow).
 *
 * The Payment Records API allows you to record payments that happen outside
 * of Stripe (e.g., via PayNow QR code) and link them to PaymentIntents.
 *
 * @see https://docs.stripe.com/custom-payment-methods
 * @see https://docs.stripe.com/api/payment-records
 */
import Stripe from 'stripe';

const stripeEnv = process.env.NEXT_PUBLIC_HITPAY_ENV || 'sandbox';
const resolvedSecretKey =
  stripeEnv === 'production' ? process.env.STRIPE_SECRET_KEY_PRODUCTION
  : stripeEnv === 'staging'  ? process.env.STRIPE_SECRET_KEY_STAGING
  : process.env.STRIPE_SECRET_KEY_SANDBOX;

if (!resolvedSecretKey) {
  throw new Error(
    `STRIPE_SECRET_KEY_${stripeEnv.toUpperCase()} is not set. Please configure it in your .env.local file.\n` +
      'Get your secret key from: https://dashboard.stripe.com/apikeys'
  );
}

/** Resolved Stripe secret key for the active environment. */
export const STRIPE_SECRET_KEY = resolvedSecretKey;

/**
 * Stripe client instance configured for Custom Payment Methods.
 *
 * Uses a beta API version that includes the Payment Records API.
 * The @ts-expect-error is needed because this beta version is not
 * recognized by the current @stripe/stripe-js TypeScript definitions.
 */
export const stripe = new Stripe(resolvedSecretKey, {
  // The Payment Records API requires this beta API version.
  // The 'clover' tag enables custom payment method features.
  // @ts-expect-error - Beta API version for Payment Records (stripe.paymentRecords.reportPayment)
  apiVersion: '2025-12-15.clover',
  typescript: true,
});
