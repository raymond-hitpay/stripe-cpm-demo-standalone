/**
 * GET /api/subscription/invoice-status?invoiceId=in_xxx
 *
 * Polling endpoint for AutoChargePaymentElement in the original tab.
 * Returns the current payment state of an invoice. The original tab polls
 * this endpoint every 2s and redirects to success when paid === true.
 *
 * The invoice is marked paid by the setup page (/subscribe/setup) via a
 * direct call to /api/subscription/charge-invoice after HitPay redirects back.
 * webhookConfirmed is set as a secondary signal by the HitPay charge.created
 * webhook, but is not required for the polling check to succeed.
 */
import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const invoiceId = searchParams.get('invoiceId');

  if (!invoiceId || !invoiceId.startsWith('in_')) {
    return NextResponse.json(
      { error: 'invoiceId is required and must start with "in_"' },
      { status: 400 }
    );
  }

  try {
    const invoice = await stripe.invoices.retrieve(invoiceId);

    return NextResponse.json({
      invoiceId: invoice.id,
      status: invoice.status,
      paid: invoice.status === 'paid',
      webhookConfirmed: invoice.metadata?.hitpay_webhook_confirmed === 'true',
      hitpayPaymentId: invoice.metadata?.hitpay_payment_id || null,
      paymentRecordId: invoice.metadata?.stripe_payment_record_id || null,
      amount: invoice.amount_due / 100,
      currency: invoice.currency,
    });
  } catch (error) {
    console.error('[Invoice Status] Error retrieving invoice:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve invoice' },
      { status: 500 }
    );
  }
}
