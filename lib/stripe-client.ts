/**
 * Client-side Stripe.js loader for Custom Payment Methods.
 *
 * This file should only be imported in client components ('use client').
 *
 * @see https://docs.stripe.com/payments/payment-element/custom-payment-methods
 */
import { loadStripe, Stripe } from '@stripe/stripe-js';

// Get the publishable key for the active environment
const hitpayEnv = process.env.NEXT_PUBLIC_HITPAY_ENV || 'sandbox';
const publishableKey =
  hitpayEnv === 'production' ? process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_PRODUCTION
  : hitpayEnv === 'staging'  ? process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_STAGING
  : process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_SANDBOX;

// Log a warning in development if the key is missing
if (!publishableKey && typeof window !== 'undefined') {
  console.warn(
    `[Stripe] NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_${hitpayEnv.toUpperCase()} is not set. ` +
      'Payment features will not work. See .env.local.example for setup.'
  );
}

/**
 * Promise that resolves to the Stripe.js instance.
 *
 * Returns null if the publishable key is not configured.
 *
 * @example
 * ```tsx
 * import { stripePromise } from '@/lib/stripe-client';
 *
 * // In your component
 * const stripe = await stripePromise;
 * if (!stripe) {
 *   // Handle missing Stripe configuration
 *   return <div>Stripe not configured</div>;
 * }
 * ```
 */
export const stripePromise: Promise<Stripe | null> = publishableKey
  ? loadStripe(publishableKey)
  : Promise.resolve(null);
