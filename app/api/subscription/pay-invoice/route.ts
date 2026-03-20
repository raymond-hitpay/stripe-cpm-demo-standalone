/**
 * POST /api/subscription/pay-invoice
 *
 * Records payment and marks a Stripe invoice as paid after HitPay payment completes.
 * Uses Payment Records API for "Pay Each Invoice" subscriptions.
 *
 * Flow:
 * 1. Create custom PaymentMethod
 * 2. Attach PaymentMethod to customer
 * 3. Record payment via Payment Records API
 * 4. Attach Payment Record to invoice (marks it as paid)
 *
 * @example Request
 * ```json
 * {
 *   "invoiceId": "in_xxx",
 *   "hitpayPaymentId": "abc123",
 *   "customPaymentMethodTypeId": "cpmt_xxx"
 * }
 * ```
 */
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { stripe } from '@/lib/stripe';
import { markInvoicePaidWithFallback } from '@/lib/invoice-utils';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { invoiceId, hitpayPaymentId, customPaymentMethodTypeId } = body;

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

    console.log(`[Pay Invoice] Processing invoice: ${invoiceId}`);
    console.log(`[Pay Invoice] HitPay Payment ID received: ${hitpayPaymentId}`);
    console.log(`[Pay Invoice] CPM Type ID: ${customPaymentMethodTypeId}`);

    // Get the invoice with customer and subscription expanded
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invoice = await stripe.invoices.retrieve(invoiceId, {
      expand: ['customer', 'subscription'],
    }) as any;

    // Check if already paid
    if (invoice.status === 'paid') {
      console.log(`[Pay Invoice] Invoice already paid: ${invoiceId}`);

      const subscription = invoice.subscription
        ? await stripe.subscriptions.retrieve(invoice.subscription as string)
        : null;

      return NextResponse.json({
        success: true,
        invoiceId: invoice.id,
        invoiceStatus: invoice.status,
        subscriptionId: invoice.subscription,
        subscriptionStatus: subscription?.status || 'unknown',
        message: 'Invoice was already paid',
      });
    }

    // Check if invoice is in a state that can be paid
    if (invoice.status !== 'open') {
      console.log(`[Pay Invoice] Invoice not in payable state: ${invoice.status}`);
      return NextResponse.json(
        {
          error: `Invoice cannot be paid. Current status: ${invoice.status}`,
          invoiceId: invoice.id,
          invoiceStatus: invoice.status,
        },
        { status: 400 }
      );
    }

    // Get customer from expanded invoice
    const customer = invoice.customer as Stripe.Customer;
    if (!customer || typeof customer === 'string') {
      return NextResponse.json(
        { error: 'Customer not found or not expanded' },
        { status: 400 }
      );
    }

    // Get subscription ID
    const subscriptionId = invoice.subscription
      ? (typeof invoice.subscription === 'string'
          ? invoice.subscription
          : (invoice.subscription as Stripe.Subscription).id)
      : null;

    // Use Payment Records API to record the payment and mark invoice as paid
    let paymentRecordId: string | null = null;
    let paymentMethodId: string | null = null;

    if (customPaymentMethodTypeId) {
      try {
        // Step 1: Create custom PaymentMethod
        const paymentMethod = await stripe.paymentMethods.create({
          type: 'custom',
          custom: {
            type: customPaymentMethodTypeId,
          },
        });
        paymentMethodId = paymentMethod.id;
        console.log(`[Pay Invoice] Created PaymentMethod: ${paymentMethodId}`);

        // Step 2: Attach PaymentMethod to customer
        await stripe.paymentMethods.attach(paymentMethod.id, {
          customer: customer.id,
        });
        console.log(`[Pay Invoice] Attached PaymentMethod to customer: ${customer.id}`);

        // Step 3: Record payment via Payment Records API
        const paymentRecord = await stripe.paymentRecords.reportPayment({
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
              payment_reference: hitpayPaymentId || '',
            },
          },
          initiated_at: Math.floor(Date.now() / 1000),
          customer_presence: 'on_session', // User is present scanning QR
          outcome: 'guaranteed',
          guaranteed: {
            guaranteed_at: Math.floor(Date.now() / 1000),
          },
          metadata: {
            hitpay_payment_id: hitpayPaymentId || '',
            stripe_invoice_id: invoiceId,
            subscription_id: subscriptionId || '',
            payment_method_type_id: customPaymentMethodTypeId,
            recorded_via: 'out_of_band',
          },
        });
        paymentRecordId = paymentRecord.id;
        console.log(`[Pay Invoice] Created Payment Record: ${paymentRecordId}`);

        // Step 4: Mark invoice as paid with verification and fallback
        const markResult = await markInvoicePaidWithFallback(invoiceId, paymentRecord.id, '[Pay Invoice]');
        if (!markResult.paid) {
          console.error('[Pay Invoice] Failed to mark invoice as paid after all attempts');
        }
      } catch (recordError) {
        console.error('[Pay Invoice] Payment record error:', recordError);
        console.log('[Pay Invoice] Falling back to paid_out_of_band');
        await stripe.invoices.pay(invoiceId, {
          paid_out_of_band: true,
        });
      }
    } else {
      // No CPM type provided, use simple paid_out_of_band
      console.log('[Pay Invoice] No CPM type provided, using paid_out_of_band');
      await stripe.invoices.pay(invoiceId, {
        paid_out_of_band: true,
      });
    }

    // Update invoice metadata with payment references
    await stripe.invoices.update(invoiceId, {
      metadata: {
        hitpay_payment_id: hitpayPaymentId || '',
        payment_method: paymentRecordId ? 'hitpay_payment_record' : 'hitpay_out_of_band',
        payment_method_type_id: customPaymentMethodTypeId || '',
        stripe_payment_record_id: paymentRecordId || '',
        stripe_payment_method_id: paymentMethodId || '',
        paid_at: new Date().toISOString(),
      },
    });

    // Get updated invoice and subscription status
    const updatedInvoice = await stripe.invoices.retrieve(invoiceId) as any;
    const subscription = subscriptionId
      ? await stripe.subscriptions.retrieve(subscriptionId)
      : null;

    console.log(`[Pay Invoice] Invoice status: ${updatedInvoice.status}, Subscription status: ${subscription?.status}`);

    return NextResponse.json({
      success: true,
      invoiceId: updatedInvoice.id,
      invoiceStatus: updatedInvoice.status,
      subscriptionId,
      subscriptionStatus: subscription?.status || 'unknown',
      paymentRecordId,
      paymentMethodId,
      message: paymentRecordId
        ? 'Invoice paid via Payment Records API'
        : 'Invoice marked as paid (out of band)',
    });
  } catch (error) {
    console.error('[Pay Invoice] Error:', error);

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
        error: 'Failed to mark invoice as paid',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
