/**
 * POST /api/payment/check-status
 *
 * Checks payment status. Webhook-first: checks Stripe metadata before
 * calling the HitPay API, so once the webhook has fired the polling
 * returns immediately without making an external API call.
 *
 * Flow:
 * 1. Retrieve PaymentIntent from Stripe
 * 2. If stripe_payment_record_id metadata exists → payment already recorded → return completed
 * 3. Otherwise → call HitPay API to check status
 * 4. If completed → create PaymentMethod + PaymentRecord (with idempotency key) → return completed
 *
 * Idempotency: Uses idempotencyKey `prec-{hitpayPaymentRequestId}` on reportPayment()
 * so concurrent webhook + polling calls cannot create duplicate records.
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
import { getOneTimeCpms } from '@/config/payment-methods';

export const dynamic = 'force-dynamic';

// Fallback CPM Type ID if frontend sends a generic type (e.g. "custom_payment_method")
function resolveCpmTypeId(customPaymentMethodTypeId: string | undefined): string {
  if (customPaymentMethodTypeId?.startsWith('cpmt_')) {
    return customPaymentMethodTypeId;
  }
  const oneTimeCpms = getOneTimeCpms();
  if (oneTimeCpms.length > 0) {
    return oneTimeCpms[0].id;
  }
  return process.env.NEXT_PUBLIC_CPM_TYPE_ID || 'cpmt_xxx';
}

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

    const cpmTypeId = resolveCpmTypeId(customPaymentMethodTypeId);

    // Step 1: Retrieve PaymentIntent and check if webhook already recorded the payment
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (paymentIntent.metadata?.stripe_payment_record_id) {
      console.log(
        `[Payment Check] Payment already recorded: ${paymentIntent.metadata.stripe_payment_record_id}`
      );
      return NextResponse.json({
        status: 'completed',
        stripe: {
          paymentRecordId: paymentIntent.metadata.stripe_payment_record_id,
          paymentIntentId,
        },
        message: 'Payment already recorded',
      });
    }

    // Step 2: Webhook hasn't fired yet — check HitPay API
    console.log(
      `[Payment Check] Checking HitPay status for: ${hitpayPaymentRequestId}`
    );
    const hitpayStatus = await getHitPayPaymentStatus(hitpayPaymentRequestId);

    const statusLower = hitpayStatus.status?.toLowerCase() ?? '';
    console.log(`[Payment Check] HitPay status: ${hitpayStatus.status} (normalized: ${statusLower})`);

    // Step 3: If payment is completed, record it in Stripe
    if (statusLower === 'completed') {
      console.log(`[Payment Check] Payment completed, recording in Stripe...`);

      const firstPayment = hitpayStatus.payments?.[0];
      const hitpayPaymentId =
        firstPayment?.id ??
        firstPayment?.payment_id ??
        hitpayPaymentRequestId;
      console.log(`[Payment Check] HitPay Payment ID: ${hitpayPaymentId}`);

      try {
        // Step 3a: Create an instance of a custom payment method
        const paymentMethod = await stripe.paymentMethods.create({
          type: 'custom',
          custom: {
            type: cpmTypeId,
          },
        });

        console.log(`[Payment Check] Created PaymentMethod: ${paymentMethod.id}`);

        // Step 3b: Report the payment to Stripe (idempotency key prevents duplicates with webhook)
        const paymentRecord = await stripe.paymentRecords.reportPayment(
          {
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
          },
          { idempotencyKey: `prec-${hitpayPaymentRequestId}` }
        );

        console.log(
          `[Payment Check] Stripe payment record created: ${paymentRecord.id}`
        );

        // Step 3c: Update PaymentIntent metadata for easy reference
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
        console.error('[Payment Check] Stripe recording error:', stripeError);
        if (stripeError && typeof stripeError === 'object' && 'raw' in stripeError) {
          console.error('[Payment Check] Stripe raw error:', (stripeError as { raw?: unknown }).raw);
        }

        // Update metadata even if payment record creation fails
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

    // Payment still pending or failed/expired - return normalized status
    return NextResponse.json({
      status: statusLower || hitpayStatus.status,
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
