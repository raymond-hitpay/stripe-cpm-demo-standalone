/**
 * GET /api/subscription/charge-status?invoiceId=in_xxx
 *
 * Lightweight endpoint to check if an invoice has been charged.
 * Used by the frontend to poll for charge confirmation after opening
 * the HitPay deep link in a new tab.
 *
 * Returns:
 * - 'paid': Invoice is paid, subscription is active
 * - 'processing': HitPay charge initiated but invoice not yet paid
 * - 'pending': No charge detected yet
 */
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { stripe } from '@/lib/stripe';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const invoiceId = request.nextUrl.searchParams.get('invoiceId');

  if (!invoiceId || !invoiceId.startsWith('in_')) {
    return NextResponse.json(
      { error: 'Valid invoiceId is required' },
      { status: 400 }
    );
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invoice = await stripe.invoices.retrieve(invoiceId, {
      expand: ['subscription'],
    }) as any;

    const subscription = invoice.subscription as Stripe.Subscription | null;

    if (invoice.status === 'paid') {
      return NextResponse.json({
        status: 'paid',
        invoiceStatus: invoice.status,
        subscriptionId: subscription?.id,
        subscriptionStatus: subscription?.status,
      });
    }

    if (invoice.metadata?.hitpay_payment_id) {
      return NextResponse.json({
        status: 'processing',
        invoiceStatus: invoice.status,
        subscriptionId: subscription?.id,
        subscriptionStatus: subscription?.status,
      });
    }

    return NextResponse.json({
      status: 'pending',
      invoiceStatus: invoice.status,
      subscriptionId: subscription?.id,
      subscriptionStatus: subscription?.status,
    });
  } catch (error) {
    if (error instanceof Stripe.errors.StripeError) {
      return NextResponse.json(
        { error: error.message, status: 'error' },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: 'Failed to check charge status', status: 'error' },
      { status: 500 }
    );
  }
}
