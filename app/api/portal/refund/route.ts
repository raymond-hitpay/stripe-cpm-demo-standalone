/**
 * POST /api/portal/refund
 *
 * Initiates a refund on both HitPay and Stripe:
 * 1. Refund the payment on HitPay (POST /v1/refund)
 * 2. Report the refund on Stripe (paymentRecords.reportRefund)
 * 3. Create a Credit Note on the invoice for accounting
 *
 * Request body:
 * {
 *   invoiceId: string;   // Stripe invoice ID
 *   amount: number;      // Refund amount in smallest currency unit (cents)
 * }
 */
import { NextRequest, NextResponse } from 'next/server';
import { stripe, stripeStandard } from '@/lib/stripe';
import { refundPayment } from '@/lib/hitpay';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { invoiceId, amount } = body;

    if (!invoiceId || !amount || amount <= 0) {
      return NextResponse.json(
        { error: 'invoiceId and a positive amount are required' },
        { status: 400 }
      );
    }

    // 1. Fetch invoice and extract metadata
    const invoice = await stripe.invoices.retrieve(invoiceId);
    const hitpayPaymentId = invoice.metadata?.hitpay_payment_id;
    const paymentRecordId = invoice.metadata?.stripe_payment_record_id;

    if (!hitpayPaymentId) {
      return NextResponse.json(
        { error: 'This invoice has no HitPay payment ID and cannot be refunded through this portal.' },
        { status: 400 }
      );
    }

    if (!paymentRecordId) {
      return NextResponse.json(
        { error: 'This invoice has no Stripe payment record and cannot be refunded through this portal.' },
        { status: 400 }
      );
    }

    // Convert from cents to decimal for HitPay
    const refundAmountDecimal = amount / 100;

    console.log(`[Refund] Starting refund for invoice ${invoiceId}: amount=${refundAmountDecimal} ${invoice.currency}`);

    // 2. Refund on HitPay
    let hitpayRefund;
    try {
      hitpayRefund = await refundPayment(hitpayPaymentId, refundAmountDecimal);
      console.log(`[Refund] HitPay refund successful:`, hitpayRefund);
    } catch (error) {
      console.error(`[Refund] HitPay refund failed:`, error);
      return NextResponse.json(
        { error: `HitPay refund failed: ${error instanceof Error ? error.message : 'Unknown error'}` },
        { status: 500 }
      );
    }

    // 3. Report refund on Stripe Payment Record
    let stripeRefundRecord;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      stripeRefundRecord = await (stripe as any).paymentRecords.reportRefund(paymentRecordId, {
        amount: { value: amount, currency: invoice.currency },
        processor_details: {
          type: 'custom',
          custom: {
            refund_reference: hitpayRefund.id,
          },
        },
        outcome: 'refunded',
        refunded: {
          refunded_at: Date.now(),
        },
      });
      console.log(`[Refund] Stripe refund record created:`, stripeRefundRecord?.id);
    } catch (error) {
      console.error(`[Refund] Stripe reportRefund failed (HitPay refund already processed):`, error);
      // Don't fail the request - HitPay refund already succeeded
    }

    // 4. Create Credit Note on the invoice for accounting
    let creditNote;
    try {
      creditNote = await stripeStandard.creditNotes.create({
        invoice: invoiceId,
        lines: [
          {
            type: 'custom_line_item',
            description: `Refund via HitPay (${hitpayRefund.id})`,
            quantity: 1,
            unit_amount: amount,
          },
        ],
        memo: `Refund processed via HitPay. Refund ID: ${hitpayRefund.id}`,
      });
      console.log(`[Refund] Credit Note created: ${creditNote.id}`);
    } catch (error) {
      console.error(`[Refund] Credit Note creation failed:`, error);
      // Don't fail - refund already processed on both sides
    }

    // 5. Update invoice metadata to track the refund
    try {
      await stripe.invoices.update(invoiceId, {
        metadata: {
          refund_hitpay_id: hitpayRefund.id,
          refund_amount: refundAmountDecimal.toFixed(2),
          refund_stripe_record_id: stripeRefundRecord?.id || '',
          refund_credit_note_id: creditNote?.id || '',
          refunded_at: new Date().toISOString(),
        },
      });
    } catch (error) {
      console.error(`[Refund] Failed to update invoice metadata:`, error);
    }

    return NextResponse.json({
      success: true,
      hitpayRefundId: hitpayRefund.id,
      stripeRefundRecordId: stripeRefundRecord?.id || null,
      creditNoteId: creditNote?.id || null,
      amountRefunded: refundAmountDecimal,
      currency: invoice.currency,
    });
  } catch (error) {
    console.error('[Refund] Unexpected error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Refund failed' },
      { status: 500 }
    );
  }
}
