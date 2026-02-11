/**
 * POST /api/create-payment-intent
 *
 * Creates a Stripe PaymentIntent for the checkout flow.
 *
 * This endpoint is called when the user loads the checkout page.
 * It creates a PaymentIntent that will be used with Stripe Elements.
 *
 * Note: Custom Payment Methods are NOT configured here - they are
 * configured client-side via the Elements provider's customPaymentMethods option.
 *
 * @example Request
 * ```json
 * {
 *   "amount": 1999,    // Amount in cents (e.g., 1999 = $19.99)
 *   "currency": "sgd"  // Optional, defaults to "sgd"
 * }
 * ```
 *
 * @example Response
 * ```json
 * {
 *   "clientSecret": "pi_xxx_secret_yyy",
 *   "paymentIntentId": "pi_xxx"
 * }
 * ```
 */
import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { amount, currency = 'sgd' } = body;

    // Validation with helpful error messages
    if (amount === undefined || amount === null) {
      return NextResponse.json(
        {
          error: 'Amount is required',
          hint: 'Provide amount in cents (e.g., 1000 for $10.00)',
        },
        { status: 400 }
      );
    }

    if (typeof amount !== 'number' || !Number.isInteger(amount)) {
      return NextResponse.json(
        {
          error: 'Amount must be a whole number',
          hint: 'Amount should be in cents as an integer (e.g., 1999 for $19.99)',
        },
        { status: 400 }
      );
    }

    if (amount <= 0) {
      return NextResponse.json(
        { error: 'Amount must be greater than 0' },
        { status: 400 }
      );
    }

    // Stripe has a minimum charge amount (typically 50 cents)
    if (amount < 50) {
      return NextResponse.json(
        {
          error: 'Amount must be at least 50 cents',
          hint: 'Stripe requires a minimum of 50 cents ($0.50)',
        },
        { status: 400 }
      );
    }

    // Create PaymentIntent on your Stripe account
    // Note: We only include 'card' in payment_method_types because
    // Custom Payment Methods are configured client-side via Elements
    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency: currency.toLowerCase(),
      payment_method_types: ['card'],
      metadata: {
        integration: 'standalone',
        created_at: new Date().toISOString(),
      },
    });

    console.log(`[PaymentIntent] Created: ${paymentIntent.id}`);

    return NextResponse.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
    });
  } catch (error) {
    console.error('Error creating PaymentIntent:', error);

    // Provide more context for Stripe-specific errors
    if (error instanceof Error && error.message.includes('Invalid API Key')) {
      return NextResponse.json(
        {
          error: 'Stripe configuration error',
          hint: 'Check that STRIPE_SECRET_KEY is set correctly in .env.local',
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to create payment intent' },
      { status: 500 }
    );
  }
}
