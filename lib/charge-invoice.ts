/**
 * Core logic for charging an invoice via HitPay.
 * Extracted from the route handler so it can be imported by both
 * the POST endpoint and the Stripe webhook without violating
 * Next.js route export restrictions.
 */
import Stripe from 'stripe';
import { chargeRecurringBilling } from '@/lib/hitpay';
import { stripe } from '@/lib/stripe';
import { CUSTOM_PAYMENT_METHODS } from '@/config/payment-methods';
import { markInvoicePaidWithFallback } from '@/lib/invoice-utils';

/**
 * Result from charging an invoice via HitPay
 */
export interface ChargeInvoiceResult {
  success: boolean;
  pending?: boolean;
  invoiceId: string;
  invoiceStatus: string;
  subscriptionId?: string;
  subscriptionStatus?: string;
  hitpayPaymentId?: string;
  amount?: number;
  currency?: string;
  paymentRecordId?: string | null;
  paymentMethodId?: string | null;
  originUrl?: string | null;
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

  const startTime = Date.now();
  console.log(`${logPrefix} Processing invoice: ${invoiceId} at ${new Date().toISOString()}`);

  // Step 1: Get the invoice
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const invoice = await stripe.invoices.retrieve(invoiceId, {
    expand: ['customer', 'subscription', 'default_payment_method'],
  }) as any;

  console.log(`${logPrefix} Invoice retrieved: id=${invoiceId}, status=${invoice.status}, amount_due=${invoice.amount_due}, billing_reason=${invoice.billing_reason}, metadata=${JSON.stringify(invoice.metadata || {})}`);

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

  // Idempotency: skip if charge already triggered and invoice handled
  if (invoice.metadata?.hitpay_payment_id) {
    console.log(`${logPrefix} Charge already triggered, skipping: ${invoiceId}`);
    return {
      success: true,
      pending: invoice.metadata?.hitpay_charge_pending === 'true',
      invoiceId: invoice.id,
      invoiceStatus: invoice.status,
      hitpayPaymentId: invoice.metadata.hitpay_payment_id,
      paymentRecordId: invoice.metadata.stripe_payment_record_id || null,
      message: 'Charge already triggered — invoice already handled',
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
  const originUrl = customer.metadata?.hitpay_origin_url || null;

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

    if (hitpayCharge.status !== 'succeeded' && hitpayCharge.status !== 'pending') {
      console.error(`${logPrefix} HitPay charge failed: ${hitpayCharge.status}`);
      return {
        success: false,
        invoiceId: invoice.id,
        invoiceStatus: invoice.status,
        message: 'HitPay charge failed',
        error: hitpayCharge.error || `Charge status: ${hitpayCharge.status}`,
      };
    }

    console.log(`${logPrefix} HitPay charge initiated: ${hitpayCharge.payment_id} (${hitpayCharge.status}), elapsed=${Date.now() - startTime}ms`);
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

  // Step 5: Handle charge result — treat 'pending' same as 'succeeded'.
  // For both: create Payment Record + mark invoice paid immediately.
  // For 'pending': hitpay_charge_pending=true flags that confirmation is still outstanding.
  // The charge.created webhook checks stripe_payment_record_id and becomes a no-op if already set.
  const isPending = hitpayCharge.status === 'pending';

  let paymentRecordId: string | null = null;
  let paymentMethodId: string | null = null;
  let invoiceMarkedAsPaid = false;

  // Step 5a: Resolve PaymentMethod — prefer the one already on the invoice
  // (set during setup), fall back to creating a new one for backward compat.
  const existingPM = invoice.default_payment_method as Stripe.PaymentMethod | null;

  if (existingPM && typeof existingPM === 'object') {
    paymentMethodId = existingPM.id;
    console.log(`${logPrefix} Reusing existing PM from invoice: ${existingPM.id}`);
  } else {
    // Fallback: create a new PM (backward compat for subscriptions set up before this change)
    const resolvedCpmTypeId =
      customer.metadata?.hitpay_cpm_type_id ||
      CUSTOM_PAYMENT_METHODS.find((pm) => pm.chargeAutomatically)?.id;

    console.log(`${logPrefix} No PM on invoice, creating new one. resolvedCpmTypeId: ${resolvedCpmTypeId || 'NONE'}`);

    if (resolvedCpmTypeId) {
      const newPM = await stripe.paymentMethods.create({
        type: 'custom',
        custom: { type: resolvedCpmTypeId },
        metadata: {
          hitpay_recurring_billing_id: recurringBillingId,
          hitpay_payment_method: customer.metadata?.hitpay_payment_method || '',
        },
      });
      paymentMethodId = newPM.id;
      await stripe.paymentMethods.attach(newPM.id, { customer: customer.id });

      const subscription = invoice.subscription as Stripe.Subscription | string | null;
      const subscriptionId = typeof subscription === 'string' ? subscription : subscription?.id;
      if (subscriptionId) {
        await stripe.subscriptions.update(subscriptionId, {
          default_payment_method: newPM.id,
        });
        console.log(`${logPrefix} Set default PM ${newPM.id} on subscription ${subscriptionId}`);
      }
    }
  }

  if (paymentMethodId) {
    const now = Math.floor(Date.now() / 1000);
    const paymentRecord = await stripe.paymentRecords.reportPayment(
      {
        amount_requested: { value: invoice.amount_due, currency: invoice.currency },
        customer_details: { customer: customer.id },
        payment_method_details: { payment_method: paymentMethodId },
        processor_details: {
          type: 'custom',
          custom: { payment_reference: hitpayCharge.payment_id },
        },
        initiated_at: now,
        customer_presence: 'off_session',
        outcome: isPending ? 'failed' : 'guaranteed',
        guaranteed: !isPending ? { guaranteed_at: now } : undefined,
        failed: isPending ? { failed_at: now } : undefined,
        metadata: {
          hitpay_charge_id: hitpayCharge.payment_id,
          hitpay_recurring_billing_id: recurringBillingId,
          stripe_invoice_id: invoiceId,
          charged_via: source,
          charge_status: hitpayCharge.status,
        },
      },
      { idempotencyKey: `prec-charge-${hitpayCharge.payment_id}` }
    );
    paymentRecordId = paymentRecord.id;
    console.log(`${logPrefix} PaymentRecord created: ${paymentRecord.id} (outcome: ${isPending ? 'failed' : 'guaranteed'})`);

    const markResult = await markInvoicePaidWithFallback(invoiceId, paymentRecord.id, logPrefix);
    invoiceMarkedAsPaid = markResult.paid;
    console.log(`${logPrefix} markInvoicePaid result: paid=${markResult.paid}, invoiceStatus=${markResult.invoiceStatus}`);
  } else {
    console.error(`${logPrefix} No PaymentMethod available — skipping PaymentRecord/markInvoicePaid entirely!`);
  }

  console.log(`${logPrefix} Completed charge flow for invoice ${invoiceId}: paymentRecordId=${paymentRecordId}, paymentMethodId=${paymentMethodId}, invoiceMarkedAsPaid=${invoiceMarkedAsPaid}, isPending=${isPending}, elapsed=${Date.now() - startTime}ms`);

  // Store IDs on invoice so webhook handler's idempotency guard skips re-processing
  await stripe.invoices.update(invoiceId, {
    metadata: {
      hitpay_payment_id: hitpayCharge.payment_id,
      hitpay_recurring_billing_id: recurringBillingId,
      stripe_payment_record_id: paymentRecordId || '',
      stripe_payment_method_id: paymentMethodId || '',
      hitpay_charge_pending: isPending ? 'true' : 'false',
      charged_at: new Date().toISOString(),
      charged_via: source,
    },
  });

  // Verify actual invoice and subscription status
  const verifiedInvoice = await stripe.invoices.retrieve(invoiceId, {
    expand: ['subscription'],
  }) as any;
  const subscription = verifiedInvoice.subscription as Stripe.Subscription | null;

  return {
    success: true,
    pending: isPending,
    invoiceId: invoice.id,
    invoiceStatus: verifiedInvoice.status,
    subscriptionId: subscription?.id,
    subscriptionStatus: subscription?.status,
    hitpayPaymentId: hitpayCharge.payment_id,
    amount: amountToCharge,
    currency,
    paymentRecordId,
    paymentMethodId,
    originUrl,
    message: invoiceMarkedAsPaid
      ? isPending
        ? 'HitPay charge pending — Invoice marked as paid, webhook will confirm'
        : 'HitPay charge succeeded — Invoice marked as paid'
      : 'HitPay charge completed but invoice could not be marked as paid',
  };
}
