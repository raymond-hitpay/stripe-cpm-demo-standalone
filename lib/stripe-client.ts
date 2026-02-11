/**
 * Client-side Stripe.js loader with Custom Payment Methods beta flag.
 *
 * IMPORTANT: Custom Payment Methods require loading Stripe.js with the
 * 'custom_payment_methods_beta_1' beta flag. Without this flag, the
 * customPaymentMethods option in Elements will be ignored silently.
 *
 * This file should only be imported in client components ('use client').
 *
 * @see https://docs.stripe.com/custom-payment-methods/quickstart
 */
import { loadStripe, Stripe } from '@stripe/stripe-js';

// Get the publishable key from environment
const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;

// Log a warning in development if the key is missing
if (!publishableKey && typeof window !== 'undefined') {
  console.warn(
    '[Stripe] NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is not set. ' +
      'Payment features will not work. See .env.local.example for setup.'
  );
}

/**
 * Promise that resolves to the Stripe.js instance.
 *
 * Returns null if the publishable key is not configured.
 * The beta flag enables Custom Payment Methods in the Payment Element,
 * allowing you to configure customPaymentMethods in the Elements provider.
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
  ? loadStripe(publishableKey, {
      // This beta flag enables Custom Payment Methods in the Payment Element.
      // Without this, the customPaymentMethods option will be ignored.
      betas: ['custom_payment_methods_beta_1'],
    })
  : Promise.resolve(null);
