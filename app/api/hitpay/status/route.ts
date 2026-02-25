/**
 * POST /api/hitpay/status
 *
 * Checks the status of a HitPay payment request.
 * Used for polling during subscription payments with CPM.
 *
 * @example Request
 * ```json
 * {
 *   "paymentRequestId": "abc123"
 * }
 * ```
 *
 * @example Response
 * ```json
 * {
 *   "status": "completed",
 *   "id": "abc123",
 *   "amount": "10.00",
 *   "currency": "SGD"
 * }
 * ```
 */
import { NextRequest, NextResponse } from 'next/server';
import { getHitPayPaymentStatus } from '@/lib/hitpay';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { paymentRequestId } = body;

    if (!paymentRequestId) {
      return NextResponse.json(
        { error: 'paymentRequestId is required' },
        { status: 400 }
      );
    }

    console.log(`[HitPay Status] Checking status for: ${paymentRequestId}`);
    const hitpayStatus = await getHitPayPaymentStatus(paymentRequestId);

    console.log(`[HitPay Status] Status: ${hitpayStatus.status}`);

    return NextResponse.json({
      status: hitpayStatus.status,
      id: hitpayStatus.id,
      amount: hitpayStatus.amount,
      currency: hitpayStatus.currency,
      referenceNumber: hitpayStatus.reference_number,
    });
  } catch (error) {
    console.error('[HitPay Status] Error:', error);
    return NextResponse.json(
      {
        error: 'Failed to check payment status',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
