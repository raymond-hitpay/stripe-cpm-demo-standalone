import Stripe from 'stripe';

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  // @ts-expect-error - Beta API version for Payment Records
  apiVersion: '2025-12-15.clover; ',
  typescript: true,
});
