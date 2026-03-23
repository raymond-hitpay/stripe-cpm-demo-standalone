/**
 * GET /api/portal/invoices/[invoiceId]
 *
 * Retrieves a single invoice for a customer.
 * Verifies the invoice belongs to the given customerId.
 *
 * @example GET /api/portal/invoices/in_xxx?customerId=cus_xxx
 */
import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  const { invoiceId } = await params;
  const customerId = request.nextUrl.searchParams.get('customerId');

  if (!customerId) {
    return NextResponse.json({ error: 'customerId is required' }, { status: 400 });
  }

  try {
    const inv = await stripe.invoices.retrieve(invoiceId, {
      expand: ['subscription'],
    });

    // Security: ensure invoice belongs to the requesting customer
    const invoiceCustomerId =
      typeof inv.customer === 'string' ? inv.customer : inv.customer?.id;

    if (invoiceCustomerId !== customerId) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 403 });
    }

    return NextResponse.json({
      id: inv.id,
      amount_due: inv.amount_due,
      amount_paid: inv.amount_paid,
      currency: inv.currency,
      status: inv.status,
      due_date: inv.due_date,
      period_start: inv.period_start,
      period_end: inv.period_end,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      subscription_id: (() => { const sub = (inv as any).subscription; return typeof sub === 'string' ? sub : sub?.id || null; })(),
      billing_reason: inv.billing_reason,
      hosted_invoice_url: inv.hosted_invoice_url,
      collection_method: inv.collection_method,
      // Refund-related metadata
      hitpay_payment_id: inv.metadata?.hitpay_payment_id || null,
      stripe_payment_record_id: inv.metadata?.stripe_payment_record_id || null,
      refund_hitpay_id: inv.metadata?.refund_hitpay_id || null,
      refund_amount: inv.metadata?.refund_amount || null,
      refunded_at: inv.metadata?.refunded_at || null,
    });
  } catch (error: unknown) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((error as any)?.code === 'resource_missing') {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }
    console.error('[Portal Invoice] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch invoice' }, { status: 500 });
  }
}
