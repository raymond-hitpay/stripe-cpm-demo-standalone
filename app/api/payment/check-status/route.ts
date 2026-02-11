import { NextRequest, NextResponse } from 'next/server';
import { getHitPayPaymentStatus } from '@/lib/hitpay';
import { stripe } from '@/lib/stripe';

export const dynamic = 'force-dynamic';

// Custom Payment Method Type ID - should match NEXT_PUBLIC_CPM_TYPE_ID
const CPM_TYPE_ID = process.env.NEXT_PUBLIC_CPM_TYPE_ID || 'cpmt_xxx';

export async function POST(request: NextRequest) {
  try {
    const { paymentIntentId, hitpayPaymentRequestId, customPaymentMethodTypeId } = await request.json();

    if (!paymentIntentId || !hitpayPaymentRequestId) {
      return NextResponse.json(
        { error: 'Payment intent ID and HitPay payment request ID are required' },
        { status: 400 }
      );
    }

    // Use the provided CPM Type ID or fall back to env variable
    const cpmTypeId = customPaymentMethodTypeId || CPM_TYPE_ID;

    // Step 1: Check HitPay payment status from server
    console.log(`[Payment Check] Checking HitPay status for: ${hitpayPaymentRequestId}`);
    const hitpayStatus = await getHitPayPaymentStatus(hitpayPaymentRequestId);

    console.log(`[Payment Check] HitPay status: ${hitpayStatus.status}`);

    // Step 2: If payment is completed, record it in Stripe
    if (hitpayStatus.status === 'completed') {
      console.log(`[Payment Check] Payment completed, recording in Stripe...`);

      try {
        // Get the PaymentIntent
        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

        // Idempotency check: If we already recorded this payment, return existing record
        if (paymentIntent.metadata?.stripe_payment_record_id) {
          console.log(`[Payment Check] Payment already recorded: ${paymentIntent.metadata.stripe_payment_record_id}`);
          return NextResponse.json({
            status: 'completed',
            hitpay: {
              id: hitpayStatus.id,
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

        // Step 2b: Report the payment to Stripe using Payment Record API
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
              payment_reference: hitpayPaymentRequestId,
            },
          },
          initiated_at: Math.floor(Date.now() / 1000),
          customer_presence: 'on_session',
          outcome: 'guaranteed',
          guaranteed: {
            guaranteed_at: Math.floor(Date.now() / 1000),
          },
          metadata: {
            hitpay_payment_id: hitpayPaymentRequestId,
            hitpay_reference: hitpayStatus.reference_number || '',
            stripe_payment_intent_id: paymentIntentId,
            stripe_payment_method_id: paymentMethod.id,
          },
        });

        console.log(`[Payment Check] Stripe payment record created: ${paymentRecord.id}`);

        // Also update the PaymentIntent metadata for easy reference
        await stripe.paymentIntents.update(paymentIntentId, {
          metadata: {
            external_payment_provider: 'hitpay',
            external_payment_id: hitpayPaymentRequestId,
            external_payment_status: 'completed',
            stripe_payment_record_id: paymentRecord.id,
            stripe_payment_method_id: paymentMethod.id,
          },
        });

        return NextResponse.json({
          status: 'completed',
          hitpay: {
            id: hitpayStatus.id,
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

        // Update metadata even if payment record creation fails
        try {
          await stripe.paymentIntents.update(paymentIntentId, {
            metadata: {
              external_payment_provider: 'hitpay',
              external_payment_id: hitpayPaymentRequestId,
              external_payment_status: 'completed',
              stripe_recording_error: stripeError instanceof Error ? stripeError.message : 'Unknown error',
            },
          });
        } catch (metadataError) {
          console.error('[Payment Check] Failed to update metadata:', metadataError);
        }

        return NextResponse.json({
          status: 'completed',
          hitpay: {
            id: hitpayStatus.id,
            status: hitpayStatus.status,
            amount: hitpayStatus.amount,
            currency: hitpayStatus.currency,
          },
          stripe: {
            paymentIntentId: paymentIntentId,
            recordingError: 'Failed to create Stripe payment record, but HitPay payment succeeded',
          },
          message: 'Payment confirmed (Stripe recording pending)',
        });
      }
    }

    // Payment still pending or failed
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
      { error: 'Failed to check payment status', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
