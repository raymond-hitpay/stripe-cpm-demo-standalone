/**
 * POST /api/subscription/pay-invoice
 *
 * Marks a Stripe invoice as paid after HitPay payment completes.
 * Creates a PaymentMethod with the CPM type and records via Payment Records API
 * before marking the invoice as paid.
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
import { stripe as stripeClover } from '@/lib/stripe';

// Standard Stripe client for invoice/subscription operations
const stripeStandard = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-12-15.clover' as Stripe.LatestApiVersion,
  typescript: true,
});

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

    // Get the invoice first to check its status
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invoice = await stripeStandard.invoices.retrieve(invoiceId) as any;

    // Check if already paid
    if (invoice.status === 'paid') {
      console.log(`[Pay Invoice] Invoice already paid: ${invoiceId}`);

      const subscription = invoice.subscription
        ? await stripeStandard.subscriptions.retrieve(invoice.subscription as string)
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

    let paymentRecordId: string | null = null;
    let paymentMethodId: string | null = null;

    // If CPM type ID is provided, create PaymentMethod and Payment Record
    if (customPaymentMethodTypeId && hitpayPaymentId) {
      try {
        console.log(`[Pay Invoice] Creating PaymentMethod with CPM type: ${customPaymentMethodTypeId}`);

        // Step 1: Create PaymentMethod with custom type (using clover API)
        const paymentMethod = await stripeClover.paymentMethods.create({
          type: 'custom',
          custom: {
            type: customPaymentMethodTypeId,
          },
        });

        paymentMethodId = paymentMethod.id;
        console.log(`[Pay Invoice] Created PaymentMethod: ${paymentMethodId}`);

        // Step 2: Record the payment via Payment Records API (using clover API)
        const paymentRecord = await stripeClover.paymentRecords.reportPayment({
          amount_requested: {
            value: invoice.amount_due,
            currency: invoice.currency,
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
            stripe_invoice_id: invoiceId,
            subscription_id: invoice.subscription as string || '',
            recorded_via: 'subscription_cpm',
          },
        });

        paymentRecordId = paymentRecord.id;
        console.log(`[Pay Invoice] Created Payment Record: ${paymentRecordId}`);
      } catch (cpmError) {
        // Log but continue - we still want to mark the invoice as paid
        console.error('[Pay Invoice] CPM recording error (continuing):', cpmError);
      }
    }

    // Mark the invoice as paid out of band
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const paidInvoice = await stripeStandard.invoices.pay(invoiceId, {
      paid_out_of_band: true,
    }) as any;

    console.log(`[Pay Invoice] Invoice paid: ${paidInvoice.id}, status: ${paidInvoice.status}`);

    // Update invoice metadata with payment references
    await stripeStandard.invoices.update(invoiceId, {
      metadata: {
        hitpay_payment_id: hitpayPaymentId || '',
        payment_method: 'hitpay_cpm',
        payment_method_type_id: customPaymentMethodTypeId || '',
        stripe_payment_record_id: paymentRecordId || '',
        stripe_payment_method_id: paymentMethodId || '',
        paid_at: new Date().toISOString(),
      },
    });

    // Get subscription status
    const subscription = paidInvoice.subscription
      ? await stripeStandard.subscriptions.retrieve(paidInvoice.subscription as string)
      : null;

    console.log(`[Pay Invoice] Subscription status: ${subscription?.status}`);

    return NextResponse.json({
      success: true,
      invoiceId: paidInvoice.id,
      invoiceStatus: paidInvoice.status,
      subscriptionId: paidInvoice.subscription,
      subscriptionStatus: subscription?.status || 'unknown',
      paymentRecordId,
      paymentMethodId,
      message: 'Invoice marked as paid successfully',
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
