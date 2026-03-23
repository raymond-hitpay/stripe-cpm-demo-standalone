/**
 * GET /api/portal/invoices
 *
 * Lists all invoices for a Stripe customer.
 * Used by the customer portal to display invoice history.
 *
 * @example GET /api/portal/invoices?customerId=cus_xxx
 *
 * @example Response
 * ```json
 * {
 *   "invoices": [
 *     {
 *       "id": "in_xxx",
 *       "amount_due": 2990,
 *       "currency": "sgd",
 *       "status": "open",
 *       "period_start": 1700000000,
 *       "period_end": 1702592000,
 *       ...
 *     }
 *   ]
 * }
 * ```
 */
import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const customerId = request.nextUrl.searchParams.get('customerId');

  if (!customerId) {
    return NextResponse.json(
      { error: 'customerId is required' },
      { status: 400 }
    );
  }

  try {
    const invoicesResult = await stripe.invoices.list({
      customer: customerId,
      limit: 20,
      expand: ['data.subscription'],
    });

    const invoices = invoicesResult.data.map((inv) => ({
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
      refund_hitpay_id: inv.metadata?.refund_hitpay_id || null,
    }));

    return NextResponse.json({ invoices });
  } catch (error) {
    console.error('[Portal Invoices] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch invoices' },
      { status: 500 }
    );
  }
}
