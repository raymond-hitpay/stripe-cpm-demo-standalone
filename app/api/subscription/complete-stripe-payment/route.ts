/**
 * POST /api/subscription/complete-stripe-payment
 *
 * Activates a subscription invoice after a Stripe card payment confirmation.
 *
 * Primary path (invoice PI confirmed via confirmPayment):
 *   Stripe auto-marks the invoice paid when confirmPayment() succeeds on the invoice's
 *   own PaymentIntent. This endpoint will find the invoice already paid (or the PI matched
 *   and succeeded) and return success immediately without any additional action.
 *
 * create-subscription always provides the invoice's own PI client_secret (fetching directly
 * if the nested expansion doesn't populate it), so the PI passed here will always be linked
 * to the invoice.
 *
 * Idempotent: always safe to call — returns success if invoice is already paid.
 *
 * @example Request
 * ```json
 * { "invoiceId": "in_xxx", "paymentIntentId": "pi_xxx" }
 * ```
 *
 * @example Response
 * ```json
 * {
 *   "success": true,
 *   "invoiceId": "in_xxx",
 *   "invoiceStatus": "paid",
 *   "subscriptionId": "sub_xxx",
 *   "subscriptionStatus": "active"
 * }
 * ```
 */
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { stripeStandard as stripe } from '@/lib/stripe';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { invoiceId, paymentIntentId } = body as {
      invoiceId: string;
      paymentIntentId?: string;
    };

    if (!invoiceId) {
      return NextResponse.json({ error: 'invoiceId is required' }, { status: 400 });
    }

    if (!invoiceId.startsWith('in_')) {
      return NextResponse.json(
        { error: 'Invalid invoiceId format. Must start with "in_"' },
        { status: 400 }
      );
    }

    console.log('[CompleteStripePayment] Processing invoice:', invoiceId, 'PI:', paymentIntentId);

    // Retrieve invoice expanding payment_intent and subscription
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invoice = await stripe.invoices.retrieve(invoiceId, {
      expand: ['subscription', 'payment_intent'],
    }) as any;

    // Idempotent: invoice already paid (normal case — Stripe auto-paid via invoice PI)
    if (invoice.status === 'paid') {
      console.log('[CompleteStripePayment] Invoice already paid:', invoiceId);
      const subscription = invoice.subscription as Stripe.Subscription | null;
      return NextResponse.json({
        success: true,
        invoiceId: invoice.id,
        invoiceStatus: invoice.status,
        subscriptionId: subscription?.id,
        subscriptionStatus: subscription?.status,
      });
    }

    // Only open invoices can be acted upon
    if (invoice.status !== 'open') {
      console.log('[CompleteStripePayment] Invoice not in collectable state:', invoice.status);
      return NextResponse.json(
        {
          error: `Invoice cannot be paid. Current status: ${invoice.status}`,
          invoiceId: invoice.id,
          invoiceStatus: invoice.status,
        },
        { status: 400 }
      );
    }

    // Check if the confirmed PI is the invoice's own PI.
    // invoice.payment_intent may be a string ID or an expanded object depending on Stripe SDK version,
    // so extract the ID defensively before comparing.
    if (paymentIntentId) {
      const invoicePaymentIntentField = invoice.payment_intent;
      const invoicePIId =
        typeof invoicePaymentIntentField === 'string'
          ? invoicePaymentIntentField
          : (invoicePaymentIntentField as Stripe.PaymentIntent | null)?.id;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const confirmedPI = await stripe.paymentIntents.retrieve(paymentIntentId) as any;

      // Determine if this PI is linked to the invoice:
      // - direct match: PI ID equals the invoice's payment_intent field
      // - Stripe-linked: the PI's own `invoice` field points to this invoice
      const piLinkedToInvoice =
        invoicePIId === paymentIntentId ||
        (confirmedPI.invoice as string | null) === invoiceId;

      if (piLinkedToInvoice) {
        if (confirmedPI.status === 'succeeded' || confirmedPI.status === 'processing') {
          console.log('[CompleteStripePayment] PI confirmed and linked to invoice:', paymentIntentId);

          // Re-fetch invoice — Stripe may have auto-paid it after PI succeeded
          const refreshedInvoice = await stripe.invoices.retrieve(invoiceId, {
            expand: ['subscription'],
          }) as any;

          let invoiceStatus = refreshedInvoice.status;

          if (invoiceStatus !== 'paid') {
            // Invoice still open despite PI succeeding — explicitly pay it
            console.log('[CompleteStripePayment] Invoice still', invoiceStatus, '— attempting invoices.pay()');
            try {
              await stripe.invoices.pay(invoiceId);
              invoiceStatus = 'paid';
              console.log('[CompleteStripePayment] invoices.pay() succeeded');
            } catch (payErr) {
              console.warn('[CompleteStripePayment] invoices.pay() failed, falling back to paid_out_of_band:', payErr);
              try {
                await stripe.invoices.pay(invoiceId, { paid_out_of_band: true });
                invoiceStatus = 'paid';
                console.log('[CompleteStripePayment] paid_out_of_band succeeded');
              } catch (oobErr) {
                console.error('[CompleteStripePayment] paid_out_of_band also failed:', oobErr);
                return NextResponse.json(
                  { error: 'Payment succeeded but invoice could not be marked as paid. Please contact support.' },
                  { status: 500 }
                );
              }
            }
          }

          // Re-fetch subscription for accurate status after invoice paid
          const sub = refreshedInvoice.subscription as Stripe.Subscription | null;
          const subscriptionObj = sub?.id
            ? await stripe.subscriptions.retrieve(sub.id)
            : null;

          return NextResponse.json({
            success: true,
            invoiceId: invoice.id,
            invoiceStatus,
            subscriptionId: subscriptionObj?.id ?? sub?.id,
            subscriptionStatus: subscriptionObj?.status ?? sub?.status,
          });
        }
        // PI linked but in unexpected status — surface the error
        console.error('[CompleteStripePayment] Invoice PI in unexpected status:', confirmedPI.status, 'for invoice:', invoiceId);
        return NextResponse.json(
          { error: `PaymentIntent is in unexpected status: ${confirmedPI.status}. Invoice could not be confirmed.` },
          { status: 400 }
        );
      }

      // PI is not linked to this invoice at all
      console.error('[CompleteStripePayment] PI not linked to invoice:', {
        paymentIntentId,
        invoicePIId,
        confirmedPIInvoice: confirmedPI.invoice,
        invoiceId,
      });
    }

    // Invoice still open and no valid PI provided — surface the error
    console.error('[CompleteStripePayment] Invoice still open after PI confirmation:', invoiceId);
    return NextResponse.json(
      { error: 'Invoice could not be confirmed. The PaymentIntent is not linked to this invoice.' },
      { status: 400 }
    );
  } catch (error) {
    console.error('[CompleteStripePayment] Error:', error);

    if (error instanceof Stripe.errors.StripeError) {
      return NextResponse.json(
        { error: error.message, code: error.code, type: error.type },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        error: 'Failed to complete stripe payment',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
