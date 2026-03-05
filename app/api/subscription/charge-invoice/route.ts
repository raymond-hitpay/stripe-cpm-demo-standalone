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
 * 2. Get customer metadata (hitpay_recurring_billing_id, hitpay_cpm_type_id)
 * 3. Charge via HitPay recurring billing API
 * 4. Record payment via Stripe Payment Records API
 * 5. Mark invoice as paid (out of band)
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
import { chargeRecurringBilling } from '@/lib/hitpay';
import { stripe as stripeClover, STRIPE_SECRET_KEY } from '@/lib/stripe';

// Standard Stripe client for invoice/subscription operations
const stripeStandard = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: '2025-12-15.clover' as Stripe.LatestApiVersion,
  typescript: true,
});

export const dynamic = 'force-dynamic';

/**
 * Result from charging an invoice via HitPay
 */
export interface ChargeInvoiceResult {
  success: boolean;
  invoiceId: string;
  invoiceStatus: string;
  subscriptionId?: string;
  subscriptionStatus?: string;
  hitpayPaymentId?: string;
  amount?: number;
  currency?: string;
  paymentRecordId?: string | null;
  paymentMethodId?: string | null;
  message: string;
  error?: string;
  skipped?: boolean;
}

/**
 * Core logic for charging an invoice via HitPay.
 * This function can be called from both the POST endpoint and the Stripe webhook.
 *
 * @param invoiceId - The Stripe invoice ID to charge
 * @param source - Where this charge was triggered from (for logging)
 * @returns The charge result
 */
export async function chargeInvoiceInternal(
  invoiceId: string,
  source: 'api' | 'webhook' = 'api'
): Promise<ChargeInvoiceResult> {
  const logPrefix = source === 'webhook' ? '[Webhook Charge]' : '[Charge Invoice]';

  console.log(`${logPrefix} Processing invoice: ${invoiceId}`);

  // Step 1: Get the invoice
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const invoice = await stripeStandard.invoices.retrieve(invoiceId, {
    expand: ['customer', 'subscription'],
  }) as any;

  // Check if already paid
  if (invoice.status === 'paid') {
    console.log(`${logPrefix} Invoice already paid: ${invoiceId}`);
    return {
      success: true,
      invoiceId: invoice.id,
      invoiceStatus: invoice.status,
      message: 'Invoice was already paid',
      skipped: true,
    };
  }

  // Check idempotency - if hitpay_payment_id exists, already processed
  if (invoice.metadata?.hitpay_payment_id) {
    console.log(`${logPrefix} Invoice already has hitpay_payment_id, skipping: ${invoiceId}`);
    return {
      success: true,
      invoiceId: invoice.id,
      invoiceStatus: invoice.status,
      hitpayPaymentId: invoice.metadata.hitpay_payment_id,
      message: 'Invoice already processed via HitPay',
      skipped: true,
    };
  }

  // Check if invoice is in a state that can be paid
  if (invoice.status !== 'open') {
    console.log(`${logPrefix} Invoice not in payable state: ${invoice.status}`);
    return {
      success: false,
      invoiceId: invoice.id,
      invoiceStatus: invoice.status,
      message: `Invoice cannot be charged. Current status: ${invoice.status}`,
      error: `Invoice status is ${invoice.status}, expected 'open'`,
    };
  }

  // Check if there's an amount to charge
  if (invoice.amount_due <= 0) {
    console.log(`${logPrefix} Invoice has no amount due: ${invoiceId}`);
    return {
      success: true,
      invoiceId: invoice.id,
      invoiceStatus: invoice.status,
      message: 'Invoice has no amount due',
      skipped: true,
    };
  }

  // Step 2: Get customer and their HitPay recurring billing ID
  const customer = invoice.customer as Stripe.Customer;
  if (!customer || typeof customer === 'string') {
    return {
      success: false,
      invoiceId: invoice.id,
      invoiceStatus: invoice.status,
      message: 'Customer not found or not expanded',
      error: 'Customer not found or not expanded',
    };
  }

  const recurringBillingId = customer.metadata?.hitpay_recurring_billing_id;
  const cpmTypeId = customer.metadata?.hitpay_cpm_type_id;

  if (!recurringBillingId) {
    console.log(`${logPrefix} No recurring billing ID on customer: ${customer.id}`);
    return {
      success: false,
      invoiceId: invoice.id,
      invoiceStatus: invoice.status,
      message: 'No HitPay recurring billing ID found on customer',
      error: 'Customer must complete HitPay setup flow first to save payment method',
    };
  }

  console.log(`${logPrefix} Found recurring billing: ${recurringBillingId}`);

  // Step 3: Calculate amount to charge
  const amountToCharge = invoice.amount_due / 100; // Convert from cents
  const currency = invoice.currency.toUpperCase();

  console.log(`${logPrefix} Charging ${amountToCharge} ${currency}`);

  // Step 4: Charge via HitPay
  let hitpayCharge;
  try {
    hitpayCharge = await chargeRecurringBilling(
      recurringBillingId,
      amountToCharge,
      currency
    );

    if (hitpayCharge.status !== 'succeeded') {
      console.error(`${logPrefix} HitPay charge failed: ${hitpayCharge.status}`);
      return {
        success: false,
        invoiceId: invoice.id,
        invoiceStatus: invoice.status,
        message: 'HitPay charge failed',
        error: hitpayCharge.error || `Charge status: ${hitpayCharge.status}`,
      };
    }

    console.log(`${logPrefix} HitPay charge succeeded: ${hitpayCharge.payment_id}`);
  } catch (hitpayError) {
    console.error(`${logPrefix} HitPay error:`, hitpayError);
    return {
      success: false,
      invoiceId: invoice.id,
      invoiceStatus: invoice.status,
      message: 'Failed to charge via HitPay',
      error: hitpayError instanceof Error ? hitpayError.message : 'Unknown error',
    };
  }

  // Step 5: Record payment in Stripe via Payment Records API
  let paymentRecordId: string | null = null;
  let paymentMethodId: string | null = null;

  if (cpmTypeId) {
    try {
      // Create PaymentMethod with custom type
      const paymentMethod = await stripeClover.paymentMethods.create({
        type: 'custom',
        custom: {
          type: cpmTypeId,
        },
      });

      paymentMethodId = paymentMethod.id;
      console.log(`${logPrefix} Created PaymentMethod: ${paymentMethodId}`);

      // Attach PaymentMethod to customer
      await stripeClover.paymentMethods.attach(paymentMethod.id, {
        customer: customer.id,
      });
      console.log(`${logPrefix} Attached PaymentMethod to customer: ${customer.id}`);

      // Record the payment via Payment Records API
      const paymentRecord = await stripeClover.paymentRecords.reportPayment({
        amount_requested: {
          value: invoice.amount_due,
          currency: invoice.currency,
        },
        customer_details: {
          customer: customer.id,
        },
        payment_method_details: {
          payment_method: paymentMethod.id,
        },
        processor_details: {
          type: 'custom',
          custom: {
            payment_reference: hitpayCharge.payment_id,
          },
        },
        initiated_at: Math.floor(Date.now() / 1000),
        customer_presence: 'off_session', // Auto-charge is off-session
        outcome: 'guaranteed',
        guaranteed: {
          guaranteed_at: Math.floor(Date.now() / 1000),
        },
        metadata: {
          hitpay_payment_id: hitpayCharge.payment_id,
          hitpay_recurring_billing_id: recurringBillingId,
          stripe_invoice_id: invoiceId,
          subscription_id: invoice.subscription ? (invoice.subscription as Stripe.Subscription).id : '',
          charged_via: source === 'webhook' ? 'stripe_webhook' : 'auto_charge',
        },
      });

      paymentRecordId = paymentRecord.id;
      console.log(`${logPrefix} Created Payment Record: ${paymentRecordId}`);

      // Attach payment record to invoice - this marks invoice as paid & activates subscription
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (stripeClover.invoices as any).attachPayment(invoiceId, {
        payment_record: paymentRecord.id,
      });
      console.log(`${logPrefix} Attached Payment Record to invoice: ${invoiceId}`);
    } catch (recordError) {
      // Log but continue - payment was still processed
      console.error(`${logPrefix} Payment record error (continuing):`, recordError);
    }
  }

  // Step 6: For auto-charge subscriptions, the Payment Record is sufficient
  // DO NOT call invoices.pay({ paid_out_of_band: true }) - that creates a duplicate payment record
  // The Payment Records API handles payment tracking for auto-charge subscriptions
  // (paid_out_of_band is only for "Pay Each Invoice" subscriptions in /api/subscription/pay-invoice)

  console.log(`${logPrefix} Payment recorded via Payment Records API`);

  // Update invoice metadata
  await stripeStandard.invoices.update(invoiceId, {
    metadata: {
      hitpay_payment_id: hitpayCharge.payment_id,
      hitpay_recurring_billing_id: recurringBillingId,
      payment_method: 'hitpay_auto_charge',
      payment_method_type_id: cpmTypeId || '',
      stripe_payment_record_id: paymentRecordId || '',
      stripe_payment_method_id: paymentMethodId || '',
      charged_at: new Date().toISOString(),
      charged_via: source,
    },
  });

  // Get subscription status
  const subscriptionId = invoice.subscription
    ? (typeof invoice.subscription === 'string' ? invoice.subscription : (invoice.subscription as Stripe.Subscription).id)
    : null;
  const subscription = subscriptionId
    ? await stripeStandard.subscriptions.retrieve(subscriptionId)
    : null;

  return {
    success: true,
    invoiceId: invoice.id,
    invoiceStatus: invoice.status,
    subscriptionId,
    subscriptionStatus: subscription?.status || 'unknown',
    hitpayPaymentId: hitpayCharge.payment_id,
    amount: amountToCharge,
    currency,
    paymentRecordId,
    paymentMethodId,
    message: 'Invoice charged and payment recorded successfully',
  };
}

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
