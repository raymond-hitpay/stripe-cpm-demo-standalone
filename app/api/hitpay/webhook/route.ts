/**
 * POST /api/hitpay/webhook
 *
 * Webhook handler for HitPay payment notifications. Handles two event types:
 *
 * 1. One-time payment webhooks (form-urlencoded, no "event" field):
 *    Fired when a payment request status changes. Used as a backup to polling.
 *
 * 2. recurring_billing.method_attached (JSON, "event" field present):
 *    Fired when a customer authorizes their payment method for auto-charge.
 *    This is the primary trigger for charging the first subscription invoice —
 *    more reliable than the browser redirect to /subscribe/setup.
 *
 * Setup Instructions:
 * 1. Deploy your app to get a public URL
 * 2. Configure webhook URL in HitPay Dashboard: https://yoursite.com/api/hitpay/webhook
 * 3. Copy the webhook salt and set it as HITPAY_SALT in your environment
 *
 * @see https://hit-pay.com/docs/api#webhooks
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyHitPayWebhook, verifyHitPayJsonWebhook, getHitPayPaymentStatus } from '@/lib/hitpay';
import { stripe } from '@/lib/stripe';
import { chargeInvoiceInternal } from '@/app/api/subscription/charge-invoice/route';

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
    let rawPayload: Record<string, unknown>;

    if (contentType.includes('application/x-www-form-urlencoded')) {
      const formData = await request.formData();
      rawPayload = Object.fromEntries(formData.entries()) as Record<string, unknown>;
    } else {
      rawPayload = await request.json();
    }

    // -------------------------------------------------------------------------
    // Handle recurring billing events (JSON with top-level "event" field)
    // -------------------------------------------------------------------------
    if (typeof rawPayload.event === 'string') {
      const event = rawPayload.event;
      console.log(`[HitPay Webhook] Received event: ${event}`);

      const hmac = typeof rawPayload.hmac === 'string' ? rawPayload.hmac : null;
      if (!hmac) {
        console.warn('[HitPay Webhook] No hmac field — proceeding without signature verification');
      } else {
        if (!verifyHitPayJsonWebhook(rawPayload, hmac)) {
          console.error('[HitPay Webhook] Invalid HMAC signature for event webhook');
          return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
        }
      }

      if (event === 'recurring_billing.method_attached') {
        const recurringBilling = rawPayload.recurring_billing as Record<string, unknown> | undefined;
        if (!recurringBilling) {
          console.error('[HitPay Webhook] Missing recurring_billing in payload');
          return NextResponse.json({ error: 'Missing recurring_billing' }, { status: 400 });
        }

        const redirectUrl = recurringBilling.redirect_url as string | undefined;
        if (!redirectUrl) {
          console.error('[HitPay Webhook] No redirect_url in recurring_billing payload');
          return NextResponse.json({ error: 'Missing redirect_url' }, { status: 400 });
        }

        let invoiceId: string | null = null;
        try {
          invoiceId = new URL(redirectUrl).searchParams.get('invoice_id');
        } catch {
          console.error('[HitPay Webhook] Failed to parse redirect_url:', redirectUrl);
          return NextResponse.json({ error: 'Invalid redirect_url' }, { status: 400 });
        }

        if (!invoiceId) {
          console.error('[HitPay Webhook] No invoice_id in redirect_url:', redirectUrl);
          return NextResponse.json({ error: 'Missing invoice_id in redirect_url' }, { status: 400 });
        }

        console.log(`[HitPay Webhook] Charging invoice: ${invoiceId}`);
        const result = await chargeInvoiceInternal(invoiceId, 'webhook');

        if (result.skipped) {
          console.log(`[HitPay Webhook] Invoice already paid — skipped: ${invoiceId}`);
        } else if (!result.success) {
          console.error(`[HitPay Webhook] Failed to charge invoice ${invoiceId}: ${result.error}`);
          // Return 200 to prevent HitPay from retrying indefinitely for non-retryable errors
          return NextResponse.json({ received: true, warning: result.error });
        } else {
          console.log(`[HitPay Webhook] Invoice charged: ${invoiceId}, hitpay_payment_id=${result.hitpayPaymentId}`);
        }

        return NextResponse.json({ received: true });
      }

      // Unhandled event type — acknowledge and move on
      return NextResponse.json({ received: true });
    }

    // -------------------------------------------------------------------------
    // Handle one-time payment webhooks (flat payload, no "event" field)
    // -------------------------------------------------------------------------
    const payload = rawPayload as unknown as HitPayWebhookPayload;

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
