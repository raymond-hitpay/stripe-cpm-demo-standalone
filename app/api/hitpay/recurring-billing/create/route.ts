/**
 * POST /api/hitpay/recurring-billing/create
 *
 * Creates a HitPay recurring billing session to save a payment method.
 * Used for auto-charge subscriptions where HitPay will charge the saved
 * payment method on each billing cycle.
 *
 * Flow:
 * 1. Client calls this endpoint with subscription details
 * 2. We create a HitPay recurring billing session
 * 3. Client redirects user to HitPay checkout to authorize payment method
 * 4. HitPay redirects back to our setup page with the session ID
 * 5. We charge the first invoice and store the recurring billing ID
 *
 * @example Request
 * ```json
 * {
 *   "customerId": "cus_xxx",
 *   "subscriptionId": "sub_xxx",
 *   "invoiceId": "in_xxx",
 *   "amount": 29.90,
 *   "currency": "sgd",
 *   "customerEmail": "user@example.com",
 *   "customerName": "John Doe",
 *   "paymentMethod": "shopee_recurring"
 * }
 * ```
 *
 * @example Response
 * ```json
 * {
 *   "recurringBillingId": "9741164c-...",
 *   "redirectUrl": "https://securecheckout.hit-pay.com/...",
 *   "status": "pending"
 * }
 * ```
 */
import { NextRequest, NextResponse } from 'next/server';
import { createRecurringBilling } from '@/lib/hitpay';
import { getPaymentMethodConfig } from '@/config/payment-methods';
import { stripe } from '@/lib/stripe';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      customerId,
      subscriptionId,
      invoiceId,
      amount,
      currency,
      customerEmail,
      customerName,
      customerPhone,
      customerPhoneCountryCode,
      paymentMethod,
      cpmTypeId,
      originUrl,
    } = body as {
      customerId: string;
      subscriptionId: string;
      invoiceId: string;
      amount: number;
      currency: string;
      customerEmail: string;
      customerName?: string;
      customerPhone?: string;
      customerPhoneCountryCode?: string;
      paymentMethod: string; // e.g., 'shopee_recurring', 'grabpay_direct', 'card'
      cpmTypeId?: string; // Stripe CPM Type ID for recording payments
      originUrl?: string; // Original page URL to return to after setup
    };

    // Validation
    if (!customerId || !subscriptionId || !customerEmail || !paymentMethod) {
      return NextResponse.json(
        {
          error: 'Missing required fields',
          hint: 'Provide customerId, subscriptionId, customerEmail, and paymentMethod',
        },
        { status: 400 }
      );
    }

    if (!amount || amount <= 0) {
      return NextResponse.json(
        {
          error: 'Invalid amount',
          hint: 'Amount must be greater than 0',
        },
        { status: 400 }
      );
    }

    // Build redirect URL using the request host (where the user is browsing)
    // so redirects come back to the correct origin (localhost or deployed URL)
    const host = request.headers.get('host') || 'localhost:3001';
    const protocol = request.headers.get('x-forwarded-proto') || 'http';
    const redirectBaseUrl = `${protocol}://${host}`;
    const redirectUrl = new URL('/subscribe/setup', redirectBaseUrl);
    redirectUrl.searchParams.set('subscription_id', subscriptionId);
    redirectUrl.searchParams.set('customer_id', customerId);
    redirectUrl.searchParams.set('invoice_id', invoiceId || '');

    // Webhook URL — use NEXT_PUBLIC_SITE_URL (public/deployed URL) so HitPay
    // can reach it. Falls back to request host if not set.
    const webhookBaseUrl = process.env.NEXT_PUBLIC_SITE_URL || `${protocol}://${host}`;
    const webhookUrl = new URL('/api/hitpay/webhook', webhookBaseUrl);

    console.log(`[HitPay Recurring] Creating session for ${customerEmail}, method: ${paymentMethod}, subscriptionId: ${subscriptionId}, invoiceId: ${invoiceId}, amount: ${amount} ${currency}`);

    // Pick the method-specific parameter for the inline response type.
    // See: https://docs.hit-pay.com
    const DIRECT_LINK_METHODS = ['shopee_recurring', 'grabpay_direct', 'touch_n_go'];
    const QR_METHODS = ['zalopay'];
    const INSTRUCTIONS_METHODS = ['giro'];

    const generateDirectLink = DIRECT_LINK_METHODS.includes(paymentMethod);
    const generateQr = QR_METHODS.includes(paymentMethod);
    const generateInstructions = INSTRUCTIONS_METHODS.includes(paymentMethod);

    // Create HitPay recurring billing session
    const session = await createRecurringBilling({
      name: `Subscription ${subscriptionId}`,
      customer_email: customerEmail,
      customer_name: customerName,
      customer_phone_number: customerPhone,
      phone_number_country_code: customerPhoneCountryCode,
      amount: amount, // Display amount for authorization
      currency: currency.toUpperCase(),
      save_payment_method: true,
      payment_methods: [paymentMethod],
      webhook: webhookUrl.toString(),
      redirect_url: redirectUrl.toString(),
      reference: subscriptionId,
      ...(generateDirectLink && { generate_direct_link: true }),
      ...(generateQr && { generate_qr: true }),
      ...(generateInstructions && { generate_instructions: true }),
    });

    console.log(`[HitPay Recurring] Created session: ${session.id}, url: ${session.url}, status: ${session.status}, direct_link: ${session.direct_link?.direct_link_url || 'none'}`);

    // Store the recurring billing ID in Stripe customer metadata
    // This allows the charge-invoice endpoint to find it later
    await stripe.customers.update(customerId, {
      metadata: {
        hitpay_recurring_billing_id: session.id,
        hitpay_cpm_type_id: cpmTypeId || '',
        hitpay_payment_method: paymentMethod,
        hitpay_setup_subscription_id: subscriptionId,
        hitpay_setup_at: new Date().toISOString(),
        hitpay_origin_url: originUrl || '',
      },
    });

    console.log(`[HitPay Recurring] Stored recurring billing ID in customer: ${customerId}`);

    // Create a custom PaymentMethod and attach to customer + subscription.
    // This follows the Stripe reference pattern: the PM carries the processor
    // agreement ID in its metadata, and renewal invoices inherit it via
    // subscription.default_payment_method so the webhook can reuse it.
    if (cpmTypeId) {
      try {
        const paymentMethodObj = await stripe.paymentMethods.create({
          type: 'custom',
          custom: { type: cpmTypeId },
          metadata: {
            hitpay_recurring_billing_id: session.id,
            hitpay_payment_method: paymentMethod,
          },
        });
        await stripe.paymentMethods.attach(paymentMethodObj.id, { customer: customerId });
        await stripe.subscriptions.update(subscriptionId, {
          default_payment_method: paymentMethodObj.id,
        });
        console.log(`[HitPay Recurring] Created PM ${paymentMethodObj.id} and set as default on subscription ${subscriptionId}`);
      } catch (pmError) {
        // Non-fatal: charge-invoice has a fallback that creates a PM if none exists
        console.warn('[HitPay Recurring] Failed to create/attach PaymentMethod:', pmError);
      }
    }

    return NextResponse.json({
      recurringBillingId: session.id,
      redirectUrl: session.url,
      qrCode: session.qr_code_data?.qr_code,
      directLinkUrl: session.direct_link?.direct_link_url,
      instructions: session.instructions,
      status: session.status,
    });
  } catch (error) {
    console.error('[HitPay Recurring] Error creating session:', error);

    if (error instanceof Error) {
      return NextResponse.json(
        {
          error: 'Failed to create recurring billing session',
          details: error.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to create recurring billing session' },
      { status: 500 }
    );
  }
}
