/**
 * POST /api/hitpay/recurring-billing/charge
 *
 * Charges a saved payment method from a HitPay recurring billing session.
 * Used for auto-charge subscriptions to collect payment after the customer
 * has authorized their payment method.
 *
 * This endpoint is called:
 * 1. After initial HitPay setup to charge the first invoice
 * 2. For subsequent renewals (either via webhook or manual trigger)
 *
 * @example Request
 * ```json
 * {
 *   "recurringBillingId": "9741164c-...",
 *   "amount": 29.90,
 *   "currency": "sgd"
 * }
 * ```
 *
 * @example Response
 * ```json
 * {
 *   "paymentId": "9746f906-...",
 *   "status": "succeeded",
 *   "amount": 29.90
 * }
 * ```
 */
import { NextRequest, NextResponse } from 'next/server';
import { chargeRecurringBilling } from '@/lib/hitpay';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { recurringBillingId, amount, currency } = body as {
      recurringBillingId: string;
      amount: number;
      currency: string;
    };

    // Validation
    if (!recurringBillingId) {
      return NextResponse.json(
        {
          error: 'Missing recurring billing ID',
          hint: 'Provide the HitPay recurring billing session ID',
        },
        { status: 400 }
      );
    }

    if (!amount || amount <= 0) {
      return NextResponse.json(
        {
          error: 'Invalid amount',
          hint: 'Amount must be greater than 0',
        },
        { status: 400 }
      );
    }

    console.log(`[HitPay Charge] Charging ${amount} ${currency} for session ${recurringBillingId}`);

    // Charge the saved payment method
    const charge = await chargeRecurringBilling(
      recurringBillingId,
      amount,
      currency || 'SGD'
    );

    console.log(`[HitPay Charge] Result: ${charge.status}, payment_id: ${charge.payment_id}`);

    return NextResponse.json({
      paymentId: charge.payment_id,
      recurringBillingId: charge.recurring_billing_id,
      amount: charge.amount,
      currency: charge.currency,
      status: charge.status,
    });
  } catch (error) {
    console.error('[HitPay Charge] Error:', error);

    if (error instanceof Error) {
      return NextResponse.json(
        {
          error: 'Failed to charge payment method',
          details: error.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to charge payment method' },
      { status: 500 }
    );
  }
}
