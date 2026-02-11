import { loadStripe } from '@stripe/stripe-js';

// Load Stripe with beta flag for custom payment methods
export const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!,
  {
    betas: ['custom_payment_methods_beta_1'],
  }
);
