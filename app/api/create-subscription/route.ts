/**
 * POST /api/create-subscription
 *
 * Creates a Stripe Customer and Subscription for the checkout flow.
 * Supports two billing types:
 *
 * 1. OUT_OF_BAND: User pays each invoice manually via CPM (PayNow, ShopeePay, etc.)
 *    - Uses collection_method: 'send_invoice'
 *    - Returns clientSecret for Payment Element
 *
 * 2. CHARGE_AUTOMATICALLY: HitPay charges saved payment method on renewal
 *    - Uses collection_method: 'charge_automatically'
 *    - First payment via HitPay recurring billing to save payment method
 *    - Returns subscription details for HitPay setup flow
 *
 * Note: Uses the standard Stripe client (not the clover beta) so that invoice
 * finalization properly creates and links a PaymentIntent. The clover beta is
 * only needed for paymentRecords.reportPayment(), not used here.
 *
 * @example Request (out_of_band)
 * ```json
 * {
 *   "priceId": "price_xxx",
 *   "email": "customer@example.com",
 *   "billingType": "out_of_band"
 * }
 * ```
 *
 * @example Request (charge_automatically)
 * ```json
 * {
 *   "priceId": "price_xxx",
 *   "email": "customer@example.com",
 *   "billingType": "charge_automatically",
 *   "cpmTypeId": "cpmt_xxx"
 * }
 * ```
 */
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { stripeStandard as stripeSubscriptions } from '@/lib/stripe';

export type BillingType = 'out_of_band' | 'charge_automatically';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { priceId, email, name, billingType = 'out_of_band', cpmTypeId } = body as {
      priceId: string;
      email?: string;
      name?: string;
      billingType?: BillingType;
      cpmTypeId?: string; // Required for charge_automatically
    };

    // Validation
    if (!priceId) {
      return NextResponse.json(
        {
          error: 'Price ID is required',
          hint: 'Provide a Stripe Price ID (e.g., price_xxx)',
        },
        { status: 400 }
      );
    }

    // Verify the price exists and is recurring
    let price: Stripe.Price;
    try {
      price = await stripeSubscriptions.prices.retrieve(priceId);
      if (price.type !== 'recurring') {
        return NextResponse.json(
          {
            error: 'Invalid price type',
            hint: 'The provided Price ID must be for a recurring price',
          },
          { status: 400 }
        );
      }
    } catch {
      return NextResponse.json(
        {
          error: 'Invalid Price ID',
          hint: 'The provided Price ID does not exist in Stripe',
        },
        { status: 400 }
      );
    }

    // Step 1: Create or retrieve Customer
    if (!email) {
      console.warn('[Subscription] WARNING: No email provided — customer will be created anonymously and cannot be found via portal email lookup');
    }

    let customer: Stripe.Customer;
    if (email) {
      const existingCustomers = await stripeSubscriptions.customers.list({
        email,
        limit: 1,
      });
      if (existingCustomers.data.length > 0) {
        customer = existingCustomers.data[0];
        // Update customer name if provided and different
        if (name && customer.name !== name) {
          customer = await stripeSubscriptions.customers.update(customer.id, { name });
        }
        console.log(`[Subscription] Using existing customer: ${customer.id}`);
      } else {
        customer = await stripeSubscriptions.customers.create({
          email,
          name: name || undefined,
        });
        console.log(`[Subscription] Created new customer: ${customer.id}`);
      }
    } else {
      // Create anonymous customer
      customer = await stripeSubscriptions.customers.create({
        name: name || undefined,
        metadata: {
          source: 'subscription-checkout',
          created_at: new Date().toISOString(),
        },
      });
      console.log(`[Subscription] Created anonymous customer: ${customer.id}`);
    }

    // Step 2: Create Subscription based on billing type
    const isAutoCharge = billingType === 'charge_automatically';

    console.log(`[Subscription] Creating ${billingType} subscription for ${customer.id}`);

    // Build subscription params based on billing type
    const subscriptionParams: Stripe.SubscriptionCreateParams = {
      customer: customer.id,
      items: [{ price: priceId }],
      expand: ['latest_invoice', 'latest_invoice.payment_intent', 'pending_setup_intent'],
      metadata: {
        integration: 'cpm-demo',
        billing_type: billingType,
        cpm_type_id: cpmTypeId || '',
        created_at: new Date().toISOString(),
      },
    };

    if (isAutoCharge) {
      // Auto-charge: External processor (HitPay) will charge saved payment method
      // We use charge_automatically but mark first invoice as paid out-of-band after HitPay setup
      subscriptionParams.collection_method = 'charge_automatically';
      subscriptionParams.payment_behavior = 'default_incomplete';
      subscriptionParams.payment_settings = {
        save_default_payment_method: 'on_subscription',
        payment_method_types: ['card'],  // Ensure card is available in invoice PI
      };
    } else {
      // Out-of-band: User pays each invoice manually via CPM
      subscriptionParams.collection_method = 'send_invoice';
      subscriptionParams.days_until_due = 0;
      subscriptionParams.payment_behavior = 'default_incomplete';
      subscriptionParams.payment_settings = {
        save_default_payment_method: 'on_subscription',
        payment_method_types: ['card', 'paynow'],
      };
    }

    const subscription = await stripeSubscriptions.subscriptions.create(subscriptionParams);

    // Step 3: Handle response based on billing type
    let invoice = subscription.latest_invoice as Stripe.Invoice;

    if (isAutoCharge) {
      // For auto-charge: Return subscription info for HitPay setup flow
      // The client will create a HitPay recurring billing session to save payment method
      // and then charge the first invoice
      console.log(`[Subscription] Created auto-charge: ${subscription.id}`);

      const invoiceIdOrObj = subscription.latest_invoice as Stripe.Invoice | string | null;
      const latestInvoiceId = typeof invoiceIdOrObj === 'string' ? invoiceIdOrObj : invoiceIdOrObj?.id;

      let invoiceClientSecret: string | null = null;
      let resolvedInvoice: Stripe.Invoice | null = null;

      if (latestInvoiceId) {
        // Fetch invoice directly (nested expansion on subscription.create can silently fail)
        console.log(`[Subscription] Fetching invoice: ${latestInvoiceId}`);
        let fetchedInvoice = await stripeSubscriptions.invoices.retrieve(latestInvoiceId, {
          expand: ['payment_intent'],
        });

        // For charge_automatically + default_incomplete with no existing payment method,
        // Stripe keeps the invoice in draft state (no PI yet). Finalize it to create the PI.
        // Note: with payment_behavior: 'default_incomplete', finalization does NOT auto-charge —
        // it only creates a PI in requires_payment_method state.
        if (fetchedInvoice.status === 'draft') {
          console.log(`[Subscription] Invoice is draft — finalizing to create PI: ${latestInvoiceId}`);
          fetchedInvoice = await stripeSubscriptions.invoices.finalizeInvoice(latestInvoiceId, {
            expand: ['payment_intent'],
          });
        }

        resolvedInvoice = fetchedInvoice;
        console.log(`[Subscription] Invoice status: ${fetchedInvoice.status}, PI type: ${typeof fetchedInvoice.payment_intent}`);

        const invoicePI = fetchedInvoice.payment_intent;
        let invoicePIObj: Stripe.PaymentIntent | null = null;

        if (typeof invoicePI === 'string') {
          // Expansion returned string ID — retrieve the full PI object
          console.log(`[Subscription] PI expansion returned string ID, fetching: ${invoicePI}`);
          invoicePIObj = await stripeSubscriptions.paymentIntents.retrieve(invoicePI);
        } else {
          invoicePIObj = invoicePI as Stripe.PaymentIntent | null;
        }

        if (invoicePIObj?.client_secret) {
          invoiceClientSecret = invoicePIObj.client_secret;
          console.log(`[Subscription] Using invoice PI: ${invoicePIObj.id} (invoice: ${fetchedInvoice.status})`);
        } else {
          console.error(`[Subscription] PI unavailable — type: ${typeof invoicePI}, invoice status: ${fetchedInvoice.status}`);
        }
      }

      if (!invoiceClientSecret) {
        console.error('[Subscription] Invoice PI unavailable:', {
          subscriptionId: subscription.id,
          latestInvoiceId,
          invoiceStatus: resolvedInvoice?.status,
        });
        return NextResponse.json(
          { error: 'Failed to retrieve payment intent for invoice. Please try again.' },
          { status: 500 }
        );
      }

      // Calculate amount/currency from resolved invoice (after fetch/finalization)
      const invoiceAmount = resolvedInvoice?.amount_due ? resolvedInvoice.amount_due / 100 : 0;
      const invoiceCurrency = resolvedInvoice?.currency || 'sgd';

      return NextResponse.json({
        subscriptionId: subscription.id,
        customerId: customer.id,
        customerEmail: email || customer.email,
        customerName: name || customer.name,
        invoiceId: resolvedInvoice?.id || latestInvoiceId,
        invoiceAmount,
        invoiceCurrency,
        clientSecret: invoiceClientSecret,
        billingType: 'charge_automatically',
        type: 'hitpay_setup',
      });
    }

    // For out-of-band: Finalize invoice to get PaymentIntent for Payment Element
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let invoiceWithPI = invoice as any;

    if (invoice && invoice.status === 'draft') {
      invoiceWithPI = await stripeSubscriptions.invoices.finalizeInvoice(invoice.id, {
        expand: ['payment_intent'],
      });
      console.log(`[Subscription] Finalized invoice: ${invoice.id}`);
    } else if (invoice && !invoiceWithPI?.payment_intent) {
      // If invoice is open but no payment_intent, retrieve with expansion
      invoiceWithPI = await stripeSubscriptions.invoices.retrieve(invoice.id, {
        expand: ['payment_intent'],
      });
    }

    const paymentIntent = invoiceWithPI?.payment_intent as Stripe.PaymentIntent | null;

    // Check for PaymentIntent first (normal paid subscription)
    if (paymentIntent?.client_secret) {
      console.log(`[Subscription] Created out-of-band: ${subscription.id} with PI: ${paymentIntent.id}`);
      return NextResponse.json({
        subscriptionId: subscription.id,
        clientSecret: paymentIntent.client_secret,
        customerId: customer.id,
        invoiceId: invoice?.id,
        billingType: 'out_of_band',
        type: 'payment',
      });
    }

    // Fallback to SetupIntent (trial or $0 first invoice)
    const setupIntent = subscription.pending_setup_intent as Stripe.SetupIntent | null;
    if (setupIntent?.client_secret) {
      console.log(`[Subscription] Created: ${subscription.id} with SI: ${setupIntent.id}`);
      return NextResponse.json({
        subscriptionId: subscription.id,
        clientSecret: setupIntent.client_secret,
        customerId: customer.id,
        invoiceId: invoice?.id,
        billingType: 'out_of_band',
        type: 'setup',
      });
    }

    // For out-of-band with send_invoice: Create a separate PaymentIntent for Payment Element UI
    // (send_invoice invoices don't have PaymentIntents, but we need one for CPM selection UI)
    if (invoice?.amount_due && invoice?.currency) {
      console.log(`[Subscription] Creating UI PaymentIntent for out-of-band subscription`);

      const uiPaymentIntent = await stripeSubscriptions.paymentIntents.create({
        amount: invoice.amount_due,
        currency: invoice.currency,
        customer: customer.id,
        metadata: {
          subscription_id: subscription.id,
          invoice_id: invoice.id,
          purpose: 'cpm_selection_ui', // This PI is for CPM selection only
          billing_type: 'out_of_band',
        },
      });

      console.log(`[Subscription] Created out-of-band: ${subscription.id} with UI PI: ${uiPaymentIntent.id}`);
      return NextResponse.json({
        subscriptionId: subscription.id,
        clientSecret: uiPaymentIntent.client_secret,
        customerId: customer.id,
        invoiceId: invoice.id,
        billingType: 'out_of_band',
        type: 'payment',
      });
    }

    // If we still can't create anything, log details for debugging
    console.error('[Subscription] No PaymentIntent, SetupIntent, or invoice found:', {
      subscriptionId: subscription.id,
      subscriptionStatus: subscription.status,
      invoiceId: invoice?.id,
      invoiceStatus: invoice?.status,
      invoicePaymentIntent: invoiceWithPI?.payment_intent,
    });

    return NextResponse.json(
      {
        error: 'Failed to create payment intent for subscription',
        hint: 'No PaymentIntent or SetupIntent was generated. Check subscription configuration.',
        debug: {
          subscriptionId: subscription.id,
          subscriptionStatus: subscription.status,
        },
      },
      { status: 500 }
    );
  } catch (error) {
    console.error('Error creating subscription:', error);

    // Provide more context for Stripe-specific errors
    if (error instanceof Error && error.message.includes('Invalid API Key')) {
      return NextResponse.json(
        {
          error: 'Stripe configuration error',
          hint: 'Check that STRIPE_SECRET_KEY is set correctly in .env.local',
        },
        { status: 500 }
      );
    }

    if (error instanceof Stripe.errors.StripeError) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to create subscription' },
      { status: 500 }
    );
  }
}
