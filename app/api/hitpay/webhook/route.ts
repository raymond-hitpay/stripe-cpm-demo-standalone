/**
 * POST /api/hitpay/webhook
 *
 * Webhook handler for HitPay payment notifications. Handles three event types:
 *
 * 1. New-format one-time payment webhooks (JSON, `Hitpay-Signature` header):
 *    New HitPay webhook format using HMAC-SHA256 of the raw JSON body.
 *    Payload: { id, status, reference_number, payments: [{ id, payment_type, ... }] }
 *    This is the primary payment detection mechanism — fires before polling detects completion.
 *
 * 2. Old-format one-time payment webhooks (form-urlencoded or JSON, `hmac` in body):
 *    Legacy format. Kept for backward compatibility.
 *
 * 3. recurring_billing.method_attached (JSON, "event" field present):
 *    Fired when a customer authorizes their payment method for auto-charge.
 *
 * Setup Instructions:
 * 1. Deploy your app to get a public URL
 * 2. Configure webhook URL in HitPay Dashboard: https://yoursite.com/api/hitpay/webhook
 * 3. Copy the webhook salt and set it as HITPAY_SALT in your environment
 *
 * @see https://hit-pay.com/docs/api#webhooks
 */
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import {
  verifyHitPayWebhook,
  verifyHitPayJsonWebhook,
  verifyHitPayHeaderSignature,
  getHitPayPaymentStatus,
} from '@/lib/hitpay';
import { stripe } from '@/lib/stripe';
import { CUSTOM_PAYMENT_METHODS, getOneTimeCpms } from '@/config/payment-methods';

// Disable caching for webhooks
export const dynamic = 'force-dynamic';

/**
 * HitPay webhook payload structure (old format)
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

/**
 * Resolves the Stripe CPM Type ID from a HitPay payment_type string.
 * Falls back to the first one-time CPM if no match found.
 */
function resolveCpmTypeIdFromPaymentType(paymentType: string | undefined): string {
  if (paymentType) {
    const match = CUSTOM_PAYMENT_METHODS.find((pm) => pm.hitpayMethod === paymentType);
    if (match) return match.id;
  }
  return getOneTimeCpms()[0]?.id ?? 'cpmt_xxx';
}

/**
 * Handles the actual `charge.created` recurring webhook payload from HitPay.
 *
 * Payload shape (no "event" field, no "hmac"):
 * {
 *   id: string,           // HitPay charge ID
 *   channel: 'recurrent',
 *   status: 'succeeded' | ...,
 *   payment_provider: { charge: { method: 'grabpay_recurring' | ... } },
 *   relatable: {
 *     type: 'business_charge',
 *     business_charge: {
 *       reference: 'sub_xxx',
 *       redirect_url: 'https://site/subscribe/setup?subscription_id=...&customer_id=...&invoice_id=...'
 *     }
 *   }
 * }
 */
async function handleRecurringChargeWebhook(payload: Record<string, unknown>) {
  const chargeId = payload.id as string;
  const status = (payload.status as string)?.toLowerCase();

  console.log('[HitPay Webhook] charge.created payload:', {
    id: chargeId,
    channel: payload.channel,
    status: payload.status,
    hasRelatable: !!payload.relatable,
  });

  if (status !== 'succeeded') {
    console.log('[HitPay Webhook] Recurring charge non-succeeded:', status);
    return { received: true };
  }

  const relatable = payload.relatable as Record<string, unknown> | undefined;
  const businessCharge = relatable?.business_charge as Record<string, unknown> | undefined;

  if (!businessCharge) {
    console.warn('[HitPay Webhook] charge.created: missing relatable.business_charge');
    return { received: true };
  }

  // Extract invoiceId and customerId from redirect_url query params
  const redirectUrl = businessCharge.redirect_url as string;
  let invoiceId: string | null = null;
  let stripeCustomerId: string | null = null;
  try {
    const urlParams = new URL(redirectUrl).searchParams;
    invoiceId = urlParams.get('invoice_id');
    stripeCustomerId = urlParams.get('customer_id');
  } catch {
    console.warn('[HitPay Webhook] charge.created: invalid redirect_url:', redirectUrl);
  }

  // Fallback: use businessCharge.reference (subscription ID) to find the open invoice
  const subscriptionRef = businessCharge.reference as string | undefined;
  if (!invoiceId && subscriptionRef?.startsWith('sub_')) {
    console.log('[HitPay Webhook] charge.created: falling back to subscription lookup:', subscriptionRef);
    try {
      const invoices = await stripe.invoices.list({
        subscription: subscriptionRef,
        status: 'open',
        limit: 1,
      });
      const fallbackInvoice = invoices.data[0];
      if (fallbackInvoice) {
        invoiceId = fallbackInvoice.id;
        stripeCustomerId = stripeCustomerId || (fallbackInvoice.customer as string) || null;
        console.log('[HitPay Webhook] charge.created: found invoice via subscription:', invoiceId);
      }
    } catch (lookupErr) {
      console.error('[HitPay Webhook] charge.created: subscription invoice lookup failed:', lookupErr);
    }
  }

  if (!invoiceId || !stripeCustomerId) {
    console.warn('[HitPay Webhook] charge.created: missing invoice_id or customer_id');
    return { received: true };
  }

  console.log('[HitPay Webhook] charge.created (recurrent):', {
    chargeId,
    invoiceId,
    stripeCustomerId,
    subscriptionRef: businessCharge.reference,
  });

  // Retrieve invoice
  const invoice = await stripe.invoices.retrieve(invoiceId);

  // Idempotency: only skip if we already created a payment record for this charge.
  // If the invoice is already paid (via method_attached) but no payment record exists yet,
  // fall through so we still create the Payment Record with the real HitPay charge ID.
  if (invoice.metadata?.stripe_payment_record_id) {
    if (!invoice.metadata?.hitpay_webhook_confirmed) {
      await stripe.invoices.update(invoiceId, {
        metadata: { ...invoice.metadata, hitpay_webhook_confirmed: 'true' },
      });
    }
    console.log('[HitPay Webhook] charge.created: payment record already exists:', invoice.metadata.stripe_payment_record_id);
    return { received: true, message: 'Already processed' };
  }

  // Retrieve customer to get CPM type
  const customer = (await stripe.customers.retrieve(stripeCustomerId)) as Stripe.Customer;
  const recurringBillingId = customer.metadata?.hitpay_recurring_billing_id || '';
  let resolvedCpmTypeId = customer.metadata?.hitpay_cpm_type_id;

  // Fallback: resolve CPM from payment_provider.charge.method
  if (!resolvedCpmTypeId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chargeMethod = ((payload.payment_provider as any)?.charge as any)?.method as
      | string
      | undefined;
    if (chargeMethod) {
      const match = CUSTOM_PAYMENT_METHODS.find((pm) => pm.hitpayRecurringMethod === chargeMethod);
      if (match) resolvedCpmTypeId = match.id;
    }
  }

  let paymentRecordId: string | null = null;
  let paymentMethodId: string | null = null;
  let invoiceMarkedAsPaid = false;

  if (resolvedCpmTypeId) {
    try {
      const paymentMethod = await stripe.paymentMethods.create({
        type: 'custom',
        custom: { type: resolvedCpmTypeId },
      });
      paymentMethodId = paymentMethod.id;
      await stripe.paymentMethods.attach(paymentMethod.id, { customer: stripeCustomerId });

      const paymentRecord = await stripe.paymentRecords.reportPayment(
        {
          amount_requested: { value: invoice.amount_due, currency: invoice.currency },
          customer_details: { customer: stripeCustomerId },
          payment_method_details: { payment_method: paymentMethod.id },
          processor_details: { type: 'custom', custom: { payment_reference: chargeId } },
          initiated_at: Math.floor(Date.now() / 1000),
          customer_presence: 'off_session',
          outcome: 'guaranteed',
          guaranteed: { guaranteed_at: Math.floor(Date.now() / 1000) },
          metadata: {
            hitpay_charge_id: chargeId,
            hitpay_recurring_billing_id: recurringBillingId,
            stripe_invoice_id: invoiceId,
            charged_via: 'charge_created_webhook',
          },
        },
        { idempotencyKey: `prec-charge-${chargeId}` }
      );
      paymentRecordId = paymentRecord.id;

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (stripe.invoices as any).attachPayment(invoiceId, {
          payment_record: paymentRecord.id,
        });
        invoiceMarkedAsPaid = true;
      } catch {
        await stripe.invoices.pay(invoiceId, { paid_out_of_band: true });
        invoiceMarkedAsPaid = true;
      }
    } catch (err) {
      console.error('[HitPay Webhook] charge.created: record error:', err);
    }
  }

  if (!invoiceMarkedAsPaid) {
    try {
      await stripe.invoices.pay(invoiceId, { paid_out_of_band: true });
    } catch (err) {
      console.error('[HitPay Webhook] charge.created: fallback pay error:', err);
    }
  }

  await stripe.invoices.update(invoiceId, {
    metadata: {
      hitpay_payment_id: chargeId,
      hitpay_recurring_billing_id: recurringBillingId,
      stripe_payment_record_id: paymentRecordId || '',
      stripe_payment_method_id: paymentMethodId || '',
      charged_via: 'charge_created_webhook',
      hitpay_webhook_confirmed: 'true',
    },
  });

  console.log('[HitPay Webhook] charge.created processed:', { invoiceId, paymentRecordId });
  return { received: true, paymentRecordId };
}

export async function POST(request: NextRequest) {
  try {
    // -------------------------------------------------------------------------
    // NEW FORMAT: Hitpay-Signature header present → new webhook format
    // -------------------------------------------------------------------------
    const hitpaySignatureHeader = request.headers.get('Hitpay-Signature');

    if (hitpaySignatureHeader) {
      const rawBody = await request.text();
      const eventType = request.headers.get('Hitpay-Event-Type') || '';

      console.log(`[HitPay Webhook] New format received, event: ${eventType}`);

      if (!verifyHitPayHeaderSignature(rawBody, hitpaySignatureHeader)) {
        console.error('[HitPay Webhook] Invalid Hitpay-Signature header — rejecting');
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
      }

      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(rawBody);
      } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
      }

      // Recurring charge webhook: channel === 'recurrent', no "event" field
      if (typeof payload.channel === 'string' && payload.channel === 'recurrent') {
        const result = await handleRecurringChargeWebhook(payload);
        return NextResponse.json(result);
      }

      const status = (payload.status as string)?.toLowerCase();

      // Only process completed payments
      if (status !== 'completed' && eventType !== 'completed') {
        console.log(
          `[HitPay Webhook] Ignoring non-completed: status=${status}, event=${eventType}`
        );
        return NextResponse.json({ received: true });
      }

      const payment_request_id = payload.id as string;
      const reference_number = payload.reference_number as string;
      const payments = payload.payments as Array<Record<string, unknown>> | undefined;
      const firstPayment = payments?.[0];
      const payment_id = (firstPayment?.id ??
        firstPayment?.payment_id ??
        payment_request_id) as string;
      const payment_type = firstPayment?.payment_type as string | undefined;

      const cpmTypeId = resolveCpmTypeIdFromPaymentType(payment_type);

      console.log('[HitPay Webhook] New format:', {
        payment_request_id,
        reference_number,
        payment_type,
        cpmTypeId,
      });

      const paymentIntentId = reference_number;
      if (!paymentIntentId || !paymentIntentId.startsWith('pi_')) {
        console.log('[HitPay Webhook] No valid PaymentIntent reference in webhook');
        return NextResponse.json({
          received: true,
          message: 'No PaymentIntent reference found — webhook acknowledged',
        });
      }

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

      const paymentMethod = await stripe.paymentMethods.create({
        type: 'custom',
        custom: { type: cpmTypeId },
      });

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
            custom: { payment_reference: payment_request_id },
          },
          initiated_at: Math.floor(Date.now() / 1000),
          customer_presence: 'on_session',
          outcome: 'guaranteed',
          guaranteed: { guaranteed_at: Math.floor(Date.now() / 1000) },
          metadata: {
            hitpay_payment_id: payment_id,
            hitpay_request_id: payment_request_id,
            stripe_payment_intent_id: paymentIntentId,
            stripe_payment_method_id: paymentMethod.id,
            recorded_via: 'webhook',
          },
        },
        { idempotencyKey: `prec-${payment_request_id}` }
      );

      console.log('[HitPay Webhook] Payment record created:', paymentRecord.id);

      await stripe.paymentIntents.update(paymentIntentId, {
        metadata: {
          external_payment_provider: 'hitpay',
          external_payment_id: payment_request_id,
          external_payment_status: 'completed',
          stripe_payment_record_id: paymentRecord.id,
          stripe_payment_method_id: paymentMethod.id,
          recorded_via: 'webhook',
        },
      });

      console.log('[HitPay Webhook] Successfully processed payment (new format)');
      return NextResponse.json({
        received: true,
        paymentRecordId: paymentRecord.id,
        message: 'Payment recorded successfully via webhook',
      });
    }

    // -------------------------------------------------------------------------
    // OLD FORMAT: Parse form-urlencoded or JSON body
    // -------------------------------------------------------------------------
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

        const recurringBillingId = recurringBilling.id as string | undefined;

        let invoiceId: string | null = null;
        let stripeCustomerId: string | null = null;
        try {
          const urlParams = new URL(redirectUrl).searchParams;
          invoiceId = urlParams.get('invoice_id');
          stripeCustomerId = urlParams.get('customer_id');
        } catch {
          console.warn('[HitPay Webhook] method_attached: invalid redirect_url:', redirectUrl);
        }

        if (invoiceId && stripeCustomerId) {
          // Retrieve invoice for amount/currency
          const invoice = await stripe.invoices.retrieve(invoiceId);

          // Get customer CPM type for Payment Record
          let cpmTypeId: string | undefined;
          try {
            const customer = await stripe.customers.retrieve(stripeCustomerId) as Stripe.Customer;
            cpmTypeId = customer.metadata?.hitpay_cpm_type_id || undefined;
          } catch (err) {
            console.warn('[HitPay Webhook] method_attached: could not retrieve customer:', err);
          }

          let paymentRecordId: string | null = null;
          let paymentMethodId: string | null = null;
          let invoiceMarkedPaid = false;

          if (cpmTypeId) {
            try {
              const paymentMethod = await stripe.paymentMethods.create({
                type: 'custom',
                custom: { type: cpmTypeId },
              });
              paymentMethodId = paymentMethod.id;
              await stripe.paymentMethods.attach(paymentMethod.id, { customer: stripeCustomerId });

              const paymentRecord = await stripe.paymentRecords.reportPayment(
                {
                  amount_requested: { value: invoice.amount_due, currency: invoice.currency },
                  customer_details: { customer: stripeCustomerId },
                  payment_method_details: { payment_method: paymentMethod.id },
                  processor_details: {
                    type: 'custom',
                    custom: { payment_reference: recurringBillingId || '' },
                  },
                  initiated_at: Math.floor(Date.now() / 1000),
                  customer_presence: 'off_session',
                  outcome: 'guaranteed',
                  guaranteed: { guaranteed_at: Math.floor(Date.now() / 1000) },
                  metadata: {
                    hitpay_recurring_billing_id: recurringBillingId || '',
                    stripe_invoice_id: invoiceId,
                    charged_via: 'method_attached_webhook',
                  },
                },
                { idempotencyKey: `prec-billing-${recurringBillingId}` }
              );
              paymentRecordId = paymentRecord.id;

              // Attach payment record to invoice (also marks it paid)
              try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                await (stripe.invoices as any).attachPayment(invoiceId, { payment_record: paymentRecord.id });
                invoiceMarkedPaid = true;
              } catch {
                // Invoice may already be paid — record is still created
              }
            } catch (err) {
              console.error('[HitPay Webhook] method_attached: payment record error:', err);
            }
          }

          // Fallback: mark invoice paid if not yet done
          if (!invoiceMarkedPaid) {
            try {
              await stripe.invoices.pay(invoiceId, { paid_out_of_band: true });
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : String(err);
              if (!msg.includes('already paid')) {
                console.error('[HitPay Webhook] method_attached: error marking invoice paid:', err);
              }
            }
          }

          await stripe.invoices.update(invoiceId, {
            metadata: {
              hitpay_payment_id: recurringBillingId || '',
              stripe_payment_record_id: paymentRecordId || '',
              stripe_payment_method_id: paymentMethodId || '',
              charged_via: 'method_attached_webhook',
            },
          });

          console.log(`[HitPay Webhook] method_attached: processed — invoice=${invoiceId}, record=${paymentRecordId}`);
        } else {
          console.warn(`[HitPay Webhook] method_attached: missing invoice_id or customer_id in redirect_url — billing_id=${recurringBillingId}`);
        }

        return NextResponse.json({ received: true });
      }

      // Unhandled event type — acknowledge and move on
      return NextResponse.json({ received: true });
    }

    // -------------------------------------------------------------------------
    // Recurring charge webhook arriving without Hitpay-Signature header
    // (defensive fallback — same payload shape, channel === 'recurrent')
    // -------------------------------------------------------------------------
    if (typeof rawPayload.channel === 'string' && rawPayload.channel === 'recurrent') {
      const result = await handleRecurringChargeWebhook(rawPayload);
      return NextResponse.json(result);
    }

    // -------------------------------------------------------------------------
    // Handle old-format one-time payment webhooks (flat payload, no "event" field)
    // -------------------------------------------------------------------------
    const payload = rawPayload as unknown as HitPayWebhookPayload;

    console.log('[HitPay Webhook] Received (old format):', {
      payment_request_id: payload.payment_request_id,
      reference_number: payload.reference_number,
      status: payload.status,
    });

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

    if (payload.status !== 'completed') {
      console.log(`[HitPay Webhook] Ignoring non-completed status: ${payload.status}`);
      return NextResponse.json({
        received: true,
        status: payload.status,
        message: 'Webhook received but not processed (status not completed)',
      });
    }

    const paymentIntentId = payload.reference_number;

    if (!paymentIntentId || !paymentIntentId.startsWith('pi_')) {
      console.log('[HitPay Webhook] No valid PaymentIntent reference in webhook');
      return NextResponse.json({
        received: true,
        message: 'No PaymentIntent reference found - webhook acknowledged',
      });
    }

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

    // Double-check with HitPay API (defense in depth)
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

    // Resolve CPM type from HitPay payment data
    const paymentType = hitpayStatus.payments?.[0]?.payment_type;
    const cpmTypeId = resolveCpmTypeIdFromPaymentType(paymentType);

    const paymentMethod = await stripe.paymentMethods.create({
      type: 'custom',
      custom: { type: cpmTypeId },
    });

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
      },
      { idempotencyKey: `prec-${payload.payment_request_id}` }
    );

    console.log('[HitPay Webhook] Payment record created:', paymentRecord.id);

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

    console.log('[HitPay Webhook] Successfully processed payment (old format)');

    return NextResponse.json({
      received: true,
      paymentRecordId: paymentRecord.id,
      message: 'Payment recorded successfully via webhook',
    });
  } catch (error) {
    console.error('[HitPay Webhook] Error:', error);

    // Return 200 to prevent HitPay from retrying on transient errors
    return NextResponse.json({
      received: true,
      error: error instanceof Error ? error.message : 'Unknown error',
      message: 'Webhook received but encountered an error - logged for investigation',
    });
  }
}
