/**
 * POST /api/subscription/charge-invoice
 *
 * Manually triggers HitPay charge for an open invoice (auto-charge subscriptions).
 * This endpoint can be used for demo/testing purposes.
 *
 * For production, use the Stripe webhook at /api/stripe/webhook which listens for
 * `invoice.payment_attempt_required` events and automatically charges via HitPay.
 *
 * Flow:
 * 1. Get invoice from Stripe
 * 2. Get customer metadata (hitpay_recurring_billing_id)
 * 3. Charge via HitPay recurring billing API
 * 4. For both 'succeeded' and 'pending': create Payment Record + mark invoice paid immediately.
 *    For 'pending': hitpay_charge_pending=true metadata indicates charge not yet confirmed.
 *    The charge.created webhook has an idempotency guard (stripe_payment_record_id) so it
 *    becomes a no-op if it fires after we've already handled the invoice.
 *
 * @example Request
 * ```json
 * {
 *   "invoiceId": "in_xxx"
 * }
 * ```
 *
 * @example Response
 * ```json
 * {
 *   "success": true,
 *   "invoiceId": "in_xxx",
 *   "invoiceStatus": "paid",
 *   "hitpayPaymentId": "9746f906-...",
 *   "amount": 29.90
 * }
 * ```
 */
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { chargeInvoiceInternal } from '@/lib/charge-invoice';

export const dynamic = 'force-dynamic';

/**
 * POST endpoint for manually triggering invoice charge
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { invoiceId } = body as { invoiceId: string };

    // Validation
    if (!invoiceId) {
      return NextResponse.json(
        { error: 'invoiceId is required' },
        { status: 400 }
      );
    }

    if (!invoiceId.startsWith('in_')) {
      return NextResponse.json(
        { error: 'Invalid invoiceId format. Must start with "in_"' },
        { status: 400 }
      );
    }

    const result = await chargeInvoiceInternal(invoiceId, 'api');

    if (!result.success) {
      return NextResponse.json(
        {
          error: result.error || result.message,
          invoiceId: result.invoiceId,
          invoiceStatus: result.invoiceStatus,
        },
        { status: 400 }
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('[Charge Invoice] Error:', error);

    if (error instanceof Stripe.errors.StripeError) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          type: error.type,
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        error: 'Failed to charge invoice',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
