/**
 * POST /api/payment/check-status
 *
 * Checks the HitPay payment status and records completed payments in Stripe.
 *
 * This endpoint is polled by the frontend every few seconds after displaying
 * a PayNow QR code. When the payment is completed:
 * 1. Creates a Stripe PaymentMethod with the custom payment type
 * 2. Records the payment via Stripe's Payment Records API
 * 3. Updates the PaymentIntent metadata for reference
 *
 * Idempotency: If the payment has already been recorded (checked via
 * PaymentIntent metadata), returns the existing record without creating duplicates.
 *
 * Error Recovery: If Stripe recording fails but HitPay confirms payment,
 * still returns success since the customer has paid. The error is logged
 * for manual reconciliation.
 *
 * @example Request
 * ```json
 * {
 *   "paymentIntentId": "pi_xxx",
 *   "hitpayPaymentRequestId": "abc123",
 *   "customPaymentMethodTypeId": "cpmt_xxx"  // Optional
 * }
 * ```
 *
 * @example Response (completed)
 * ```json
 * {
 *   "status": "completed",
 *   "hitpay": { "id": "abc123", "status": "completed", ... },
 *   "stripe": { "paymentRecordId": "prec_xxx", "paymentIntentId": "pi_xxx" },
 *   "message": "Payment confirmed and recorded successfully"
 * }
 * ```
 */
import { NextRequest, NextResponse } from 'next/server';
import { getHitPayPaymentStatus } from '@/lib/hitpay';
import { stripe } from '@/lib/stripe';

export const dynamic = 'force-dynamic';

// Custom Payment Method Type ID - should match NEXT_PUBLIC_CPM_TYPE_ID
const CPM_TYPE_ID = process.env.NEXT_PUBLIC_CPM_TYPE_ID || 'cpmt_xxx';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      paymentIntentId,
      hitpayPaymentRequestId,
      customPaymentMethodTypeId,
    } = body;

    // Validation with helpful error messages
    if (!paymentIntentId) {
      return NextResponse.json(
        {
          error: 'paymentIntentId is required',
          hint: 'Pass the Stripe PaymentIntent ID from the checkout session',
        },
        { status: 400 }
      );
    }

    if (!paymentIntentId.startsWith('pi_')) {
      return NextResponse.json(
        {
          error: 'Invalid paymentIntentId format',
          hint: 'PaymentIntent IDs start with "pi_"',
        },
        { status: 400 }
      );
    }

    if (!hitpayPaymentRequestId) {
      return NextResponse.json(
        {
          error: 'hitpayPaymentRequestId is required',
          hint: 'Pass the HitPay payment request ID from when the QR was created',
        },
        { status: 400 }
      );
    }

    // Use the provided CPM Type ID or fall back to env variable
    const cpmTypeId = customPaymentMethodTypeId || CPM_TYPE_ID;

    // Step 1: Check HitPay payment status
    console.log(
      `[Payment Check] Checking HitPay status for: ${hitpayPaymentRequestId}`
    );
    const hitpayStatus = await getHitPayPaymentStatus(hitpayPaymentRequestId);

    console.log(`[Payment Check] HitPay status: ${hitpayStatus.status}`);

    // Step 2: If payment is completed, record it in Stripe
    if (hitpayStatus.status === 'completed') {
      console.log(`[Payment Check] Payment completed, recording in Stripe...`);

      // Extract the actual HitPay payment ID (transaction ID) from the payments array
      // This is the unique identifier like "a12b19e4-3b07-4ecc-a621-57a751203fca"
      const hitpayPaymentId = hitpayStatus.payments?.[0]?.id || hitpayPaymentRequestId;
      console.log(`[Payment Check] HitPay Payment ID: ${hitpayPaymentId}`);

      try {
        // Get the PaymentIntent
        const paymentIntent =
          await stripe.paymentIntents.retrieve(paymentIntentId);

        // Idempotency check: If we already recorded this payment, return existing record
        if (paymentIntent.metadata?.stripe_payment_record_id) {
          console.log(
            `[Payment Check] Payment already recorded: ${paymentIntent.metadata.stripe_payment_record_id}`
          );
          return NextResponse.json({
            status: 'completed',
            hitpay: {
              id: hitpayStatus.id,
              paymentId: hitpayPaymentId,
              status: hitpayStatus.status,
              amount: hitpayStatus.amount,
              currency: hitpayStatus.currency,
            },
            stripe: {
              paymentRecordId: paymentIntent.metadata.stripe_payment_record_id,
              paymentIntentId: paymentIntentId,
            },
            message: 'Payment already recorded',
          });
        }

        // Step 2a: Create an instance of a custom payment method
        const paymentMethod = await stripe.paymentMethods.create({
          type: 'custom',
          custom: {
            type: cpmTypeId,
          },
        });

        console.log(`[Payment Check] Created PaymentMethod: ${paymentMethod.id}`);

        // Step 2b: Report the payment to Stripe using Payment Records API
        // This creates a payment record that shows in the Stripe Dashboard
        const paymentRecord = await stripe.paymentRecords.reportPayment({
          amount_requested: {
            value: paymentIntent.amount,
            currency: paymentIntent.currency,
          },
          payment_method_details: {
            payment_method: paymentMethod.id,
          },
          processor_details: {
            type: 'custom',
            custom: {
              payment_reference: hitpayPaymentId,
            },
          },
          initiated_at: Math.floor(Date.now() / 1000),
          customer_presence: 'on_session',
          outcome: 'guaranteed',
          guaranteed: {
            guaranteed_at: Math.floor(Date.now() / 1000),
          },
          metadata: {
            hitpay_payment_id: hitpayPaymentId,
            hitpay_payment_request_id: hitpayPaymentRequestId,
            hitpay_reference: hitpayStatus.reference_number || '',
            stripe_payment_intent_id: paymentIntentId,
            stripe_payment_method_id: paymentMethod.id,
            recorded_via: 'polling',
          },
        });

        console.log(
          `[Payment Check] Stripe payment record created: ${paymentRecord.id}`
        );

        // Step 2c: Update PaymentIntent metadata for easy reference
        await stripe.paymentIntents.update(paymentIntentId, {
          metadata: {
            external_payment_provider: 'hitpay',
            hitpay_payment_id: hitpayPaymentId,
            hitpay_payment_request_id: hitpayPaymentRequestId,
            external_payment_status: 'completed',
            stripe_payment_record_id: paymentRecord.id,
            stripe_payment_method_id: paymentMethod.id,
            recorded_via: 'polling',
          },
        });

        return NextResponse.json({
          status: 'completed',
          hitpay: {
            id: hitpayStatus.id,
            paymentId: hitpayPaymentId,
            status: hitpayStatus.status,
            amount: hitpayStatus.amount,
            currency: hitpayStatus.currency,
          },
          stripe: {
            paymentRecordId: paymentRecord.id,
            paymentIntentId: paymentIntentId,
          },
          message: 'Payment confirmed and recorded successfully',
        });
      } catch (stripeError: unknown) {
        // If Stripe recording fails, still return success since HitPay payment succeeded
        // The customer has paid - we just failed to record it in Stripe
        console.error('[Payment Check] Stripe recording error:', stripeError);

        // Extract payment ID for error response too
        const hitpayPaymentId = hitpayStatus.payments?.[0]?.id || hitpayPaymentRequestId;

        // Update metadata even if payment record creation fails
        // This helps with manual reconciliation
        try {
          await stripe.paymentIntents.update(paymentIntentId, {
            metadata: {
              external_payment_provider: 'hitpay',
              hitpay_payment_id: hitpayPaymentId,
              hitpay_payment_request_id: hitpayPaymentRequestId,
              external_payment_status: 'completed',
              stripe_recording_error:
                stripeError instanceof Error
                  ? stripeError.message
                  : 'Unknown error',
            },
          });
        } catch (metadataError) {
          console.error(
            '[Payment Check] Failed to update metadata:',
            metadataError
          );
        }

        return NextResponse.json({
          status: 'completed',
          hitpay: {
            id: hitpayStatus.id,
            paymentId: hitpayPaymentId,
            status: hitpayStatus.status,
            amount: hitpayStatus.amount,
            currency: hitpayStatus.currency,
          },
          stripe: {
            paymentIntentId: paymentIntentId,
            recordingError:
              'Failed to create Stripe payment record, but HitPay payment succeeded',
          },
          message: 'Payment confirmed (Stripe recording pending)',
        });
      }
    }

    // Payment still pending or failed/expired
    return NextResponse.json({
      status: hitpayStatus.status,
      hitpay: {
        id: hitpayStatus.id,
        status: hitpayStatus.status,
        amount: hitpayStatus.amount,
        currency: hitpayStatus.currency,
      },
    });
  } catch (error) {
    console.error('[Payment Check] Error:', error);
    return NextResponse.json(
      {
        error: 'Failed to check payment status',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
