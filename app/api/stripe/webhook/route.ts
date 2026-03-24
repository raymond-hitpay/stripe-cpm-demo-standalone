/**
 * POST /api/stripe/webhook
 *
 * Stripe webhook handler for automatic subscription invoice charging.
 *
 * This endpoint receives webhook events from Stripe and processes them accordingly.
 * The primary use case is handling `invoice.payment_attempt_required` events for
 * auto-charge subscriptions, which triggers automatic charging via HitPay.
 *
 * Webhook Flow:
 * 1. Stripe creates an invoice when a subscription renews and auto-finalizes it
 * 2. Stripe fires `invoice.payment_attempt_required` event
 * 3. This webhook receives the event and verifies the signature
 * 4. For customers with `hitpay_recurring_billing_id`, charges via HitPay
 * 5. Records payment in Stripe via Payment Records API
 * 6. Marks invoice as paid
 *
 * Setup Instructions:
 * 1. Deploy your app to get a public URL
 * 2. Create webhook in Stripe Dashboard:
 *    - URL: https://yoursite.com/api/stripe/webhook
 *    - Events: invoice.payment_attempt_required
 * 3. Copy webhook signing secret to STRIPE_WEBHOOK_SECRET
 * 4. Test with Stripe CLI: stripe trigger invoice.payment_attempt_required
 *
 * @see https://docs.stripe.com/billing/subscriptions/third-party-payment-processing
 */
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { chargeInvoiceInternal } from '@/lib/charge-invoice';
import { stripe } from '@/lib/stripe';

// Disable body parsing - we need the raw body for signature verification
export const dynamic = 'force-dynamic';

/**
 * Handle Stripe webhook events
 */
export async function POST(request: NextRequest) {
  try {
    // Get the raw body for signature verification
    const body = await request.text();
    const signature = request.headers.get('stripe-signature');

    if (!signature) {
      console.error('[Stripe Webhook] Missing stripe-signature header');
      return NextResponse.json(
        { error: 'Missing stripe-signature header' },
        { status: 400 }
      );
    }

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error('[Stripe Webhook] STRIPE_WEBHOOK_SECRET not configured');
      return NextResponse.json(
        { error: 'Webhook secret not configured' },
        { status: 500 }
      );
    }

    // Verify the webhook signature
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    } catch (err) {
      console.error('[Stripe Webhook] Signature verification failed:', err);
      return NextResponse.json(
        { error: 'Invalid webhook signature' },
        { status: 401 }
      );
    }

    console.log(`[Stripe Webhook] Received event: ${event.type} (${event.id})`);

    // Handle the event
    switch (event.type) {
      case 'invoice.payment_attempt_required': {
        // This event fires when an invoice is finalized and requires payment
        // via an external payment processor (our HitPay integration)
        const invoice = event.data.object as Stripe.Invoice;

        console.log(`[Stripe Webhook] Processing invoice: ${invoice.id} at ${new Date().toISOString()}`);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sub = (invoice as any).subscription;
        console.log(`[Stripe Webhook] Invoice status: ${invoice.status}, amount_due: ${invoice.amount_due}, billing_reason: ${invoice.billing_reason}, subscription: ${typeof sub === 'string' ? sub : sub?.id}, metadata: ${JSON.stringify(invoice.metadata || {})}`);

        // Skip first invoice - it will be charged by the setup page
        // Only handle renewals via webhook
        if (invoice.billing_reason === 'subscription_create') {
          console.log('[Stripe Webhook] First invoice (subscription_create) - skipping, handled by setup page');
          return NextResponse.json({
            received: true,
            message: 'First invoice skipped - handled by setup page',
          });
        }

        // Skip if no amount due
        if (invoice.amount_due <= 0) {
          console.log('[Stripe Webhook] Invoice has no amount due, skipping');
          return NextResponse.json({
            received: true,
            message: 'Invoice has no amount due',
          });
        }

        // Get customer to check if they have HitPay recurring billing set up
        const customerId = typeof invoice.customer === 'string'
          ? invoice.customer
          : invoice.customer?.id;

        if (!customerId) {
          console.log('[Stripe Webhook] No customer ID on invoice, skipping');
          return NextResponse.json({
            received: true,
            message: 'No customer ID on invoice',
          });
        }

        // Retrieve customer to check metadata
        const customer = await stripe.customers.retrieve(customerId) as Stripe.Customer;

        if (customer.deleted) {
          console.log('[Stripe Webhook] Customer was deleted, skipping');
          return NextResponse.json({
            received: true,
            message: 'Customer was deleted',
          });
        }

        const recurringBillingId = customer.metadata?.hitpay_recurring_billing_id;

        if (!recurringBillingId) {
          // This is not an auto-charge subscription via HitPay
          // It might be using a different payment method or out-of-band invoices
          console.log('[Stripe Webhook] Customer has no HitPay recurring billing ID, skipping');
          return NextResponse.json({
            received: true,
            message: 'Not a HitPay auto-charge subscription',
          });
        }

        // Charge the invoice via HitPay
        console.log(`[Stripe Webhook] Charging invoice ${invoice.id} via HitPay`);

        try {
          const result = await chargeInvoiceInternal(invoice.id, 'webhook');

          if (result.success) {
            console.log(`[Stripe Webhook] Successfully charged invoice: ${invoice.id}`);
            console.log(`[Stripe Webhook] HitPay payment ID: ${result.hitpayPaymentId}`);

            return NextResponse.json({
              received: true,
              success: true,
              invoiceId: invoice.id,
              hitpayPaymentId: result.hitpayPaymentId,
              message: result.skipped ? result.message : 'Invoice charged successfully',
            });
          } else {
            // Charge failed - log the error but return 200 to prevent retries
            // The invoice will remain open for manual intervention
            console.error(`[Stripe Webhook] Failed to charge invoice: ${result.error}`);

            return NextResponse.json({
              received: true,
              success: false,
              invoiceId: invoice.id,
              error: result.error,
              message: 'Charge failed - invoice remains open',
            });
          }
        } catch (chargeError) {
          // Unexpected error during charging
          console.error('[Stripe Webhook] Unexpected error during charge:', chargeError);

          return NextResponse.json({
            received: true,
            success: false,
            invoiceId: invoice.id,
            error: chargeError instanceof Error ? chargeError.message : 'Unknown error',
            message: 'Charge error - invoice remains open',
          });
        }
      }

      default:
        // Unhandled event type - acknowledge receipt
        console.log(`[Stripe Webhook] Unhandled event type: ${event.type}`);
        return NextResponse.json({
          received: true,
          message: `Event type ${event.type} not handled`,
        });
    }
  } catch (error) {
    // Unexpected error - log but return 200 to prevent infinite retries
    console.error('[Stripe Webhook] Unexpected error:', error);

    return NextResponse.json({
      received: true,
      error: error instanceof Error ? error.message : 'Unknown error',
      message: 'Webhook received but encountered an error',
    });
  }
}
