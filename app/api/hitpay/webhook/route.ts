/**
 * POST /api/hitpay/webhook
 *
 * Webhook handler for HitPay payment notifications.
 *
 * This endpoint receives webhook callbacks from HitPay when payment status changes.
 * It serves as a backup to polling - ensuring payments are recorded in Stripe even
 * if the user closes their browser before polling detects completion.
 *
 * Webhook Flow:
 * 1. HitPay sends POST request when payment status changes
 * 2. We verify the HMAC-SHA256 signature using HITPAY_SALT
 * 3. If payment completed, we record it in Stripe via Payment Records API
 * 4. Return 200 OK to acknowledge receipt (prevents HitPay retries)
 *
 * Setup Instructions:
 * 1. Deploy your app to get a public URL
 * 2. Configure webhook URL in HitPay Dashboard: https://yoursite.com/api/hitpay/webhook
 * 3. Copy the webhook salt and set it as HITPAY_SALT in your environment
 *
 * @see https://hit-pay.com/docs/api#webhooks
 *
 * @example Webhook Payload (form-urlencoded or JSON)
 * ```json
 * {
 *   "payment_id": "abc123",
 *   "payment_request_id": "def456",
 *   "reference_number": "pi_xxx",   // Your PaymentIntent ID
 *   "amount": "10.00",
 *   "currency": "sgd",
 *   "status": "completed",
 *   "hmac": "sha256_signature_here"
 * }
 * ```
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyHitPayWebhook, getHitPayPaymentStatus } from '@/lib/hitpay';
import { stripe } from '@/lib/stripe';

// Disable caching for webhooks
export const dynamic = 'force-dynamic';

// Custom Payment Method Type ID - should match NEXT_PUBLIC_CPM_TYPE_ID
const CPM_TYPE_ID = process.env.NEXT_PUBLIC_CPM_TYPE_ID || 'cpmt_xxx';

/**
 * HitPay webhook payload structure
 */
interface HitPayWebhookPayload {
  payment_id: string;
  payment_request_id: string;
  reference_number: string;
  amount: string;
  currency: string;
  status: 'completed' | 'failed' | 'pending' | 'expired';
  hmac: string;
}

export async function POST(request: NextRequest) {
  try {
    // Parse the webhook payload
    // HitPay may send form-urlencoded or JSON depending on configuration
    const contentType = request.headers.get('content-type') || '';
    let payload: HitPayWebhookPayload;

    if (contentType.includes('application/x-www-form-urlencoded')) {
      const formData = await request.formData();
      payload = Object.fromEntries(
        formData.entries()
      ) as unknown as HitPayWebhookPayload;
    } else {
      payload = await request.json();
    }

    console.log('[HitPay Webhook] Received:', {
      payment_request_id: payload.payment_request_id,
      reference_number: payload.reference_number,
      status: payload.status,
    });

    // Step 1: Verify the webhook signature
    // This prevents fraudulent requests from being processed
    const isValid = verifyHitPayWebhook(
      payload as unknown as Record<string, string>,
      payload.hmac
    );

    if (!isValid) {
      console.error('[HitPay Webhook] Invalid signature - rejecting request');
      return NextResponse.json(
        { error: 'Invalid webhook signature' },
        { status: 401 }
      );
    }

    console.log('[HitPay Webhook] Signature verified');

    // Step 2: Only process completed payments
    if (payload.status !== 'completed') {
      console.log(`[HitPay Webhook] Ignoring non-completed status: ${payload.status}`);
      return NextResponse.json({
        received: true,
        status: payload.status,
        message: 'Webhook received but not processed (status not completed)',
      });
    }

    // Step 3: Find the associated PaymentIntent using reference_number
    // The reference_number was set to the PaymentIntent ID when creating the HitPay request
    const paymentIntentId = payload.reference_number;

    if (!paymentIntentId || !paymentIntentId.startsWith('pi_')) {
      console.log('[HitPay Webhook] No valid PaymentIntent reference in webhook');
      // Still return 200 to prevent retries - this might be a test or different integration
      return NextResponse.json({
        received: true,
        message: 'No PaymentIntent reference found - webhook acknowledged',
      });
    }

    // Step 4: Retrieve the PaymentIntent and check idempotency
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (paymentIntent.metadata?.stripe_payment_record_id) {
      console.log(
        '[HitPay Webhook] Payment already recorded:',
        paymentIntent.metadata.stripe_payment_record_id
      );
      return NextResponse.json({
        received: true,
        message: 'Payment already recorded',
        paymentRecordId: paymentIntent.metadata.stripe_payment_record_id,
      });
    }

    // Step 5: Double-check with HitPay API (defense in depth)
    // This ensures we're recording based on actual HitPay status, not just webhook data
    const hitpayStatus = await getHitPayPaymentStatus(payload.payment_request_id);

    if (hitpayStatus.status !== 'completed') {
      console.warn(
        '[HitPay Webhook] HitPay API status does not match webhook:',
        hitpayStatus.status
      );
      return NextResponse.json({
        received: true,
        message: 'Payment status mismatch - will be handled by polling',
      });
    }

    // Step 6: Create PaymentMethod and record the payment in Stripe
    console.log('[HitPay Webhook] Recording payment in Stripe...');

    const paymentMethod = await stripe.paymentMethods.create({
      type: 'custom',
      custom: {
        type: CPM_TYPE_ID,
      },
    });

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
          payment_reference: payload.payment_request_id,
        },
      },
      initiated_at: Math.floor(Date.now() / 1000),
      customer_presence: 'on_session',
      outcome: 'guaranteed',
      guaranteed: {
        guaranteed_at: Math.floor(Date.now() / 1000),
      },
      metadata: {
        hitpay_payment_id: payload.payment_id,
        hitpay_request_id: payload.payment_request_id,
        stripe_payment_intent_id: paymentIntentId,
        stripe_payment_method_id: paymentMethod.id,
        recorded_via: 'webhook',
      },
    });

    console.log('[HitPay Webhook] Payment record created:', paymentRecord.id);

    // Step 7: Update PaymentIntent metadata
    await stripe.paymentIntents.update(paymentIntentId, {
      metadata: {
        external_payment_provider: 'hitpay',
        external_payment_id: payload.payment_request_id,
        external_payment_status: 'completed',
        stripe_payment_record_id: paymentRecord.id,
        stripe_payment_method_id: paymentMethod.id,
        recorded_via: 'webhook',
      },
    });

    console.log('[HitPay Webhook] Successfully processed payment');

    return NextResponse.json({
      received: true,
      paymentRecordId: paymentRecord.id,
      message: 'Payment recorded successfully via webhook',
    });
  } catch (error) {
    console.error('[HitPay Webhook] Error:', error);

    // IMPORTANT: Return 200 to prevent HitPay from retrying
    // Log the error for investigation, but don't cause webhook retries
    // If this is a transient error, polling will catch it; if permanent, we need to investigate
    return NextResponse.json({
      received: true,
      error: error instanceof Error ? error.message : 'Unknown error',
      message: 'Webhook received but encountered an error - logged for investigation',
    });
  }
}
