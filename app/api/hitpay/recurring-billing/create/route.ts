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
      paymentMethod,
      cpmTypeId,
    } = body as {
      customerId: string;
      subscriptionId: string;
      invoiceId: string;
      amount: number;
      currency: string;
      customerEmail: string;
      customerName?: string;
      paymentMethod: string; // e.g., 'shopee_recurring', 'grabpay_direct', 'card'
      cpmTypeId?: string; // Stripe CPM Type ID for recording payments
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

    // Build redirect URL for after customer authorizes payment method
    // Dynamically get the host from request headers
    const host = request.headers.get('host') || 'localhost:3001';
    const protocol = request.headers.get('x-forwarded-proto') || 'http';
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || `${protocol}://${host}`;
    const redirectUrl = new URL('/subscribe/setup', baseUrl);
    redirectUrl.searchParams.set('subscription_id', subscriptionId);
    redirectUrl.searchParams.set('customer_id', customerId);
    redirectUrl.searchParams.set('invoice_id', invoiceId || '');

    console.log(`[HitPay Recurring] Creating session for ${customerEmail}, method: ${paymentMethod}`);

    // Create HitPay recurring billing session
    const session = await createRecurringBilling({
      name: `Subscription ${subscriptionId}`,
      customer_email: customerEmail,
      customer_name: customerName,
      amount: amount, // Display amount for authorization
      currency: currency.toUpperCase(),
      save_payment_method: true,
      payment_methods: [paymentMethod],
      redirect_url: redirectUrl.toString(),
      reference: subscriptionId,
    });

    console.log(`[HitPay Recurring] Created session: ${session.id}`);

    // Store the recurring billing ID in Stripe customer metadata
    // This allows the charge-invoice endpoint to find it later
    await stripe.customers.update(customerId, {
      metadata: {
        hitpay_recurring_billing_id: session.id,
        hitpay_cpm_type_id: cpmTypeId || '',
        hitpay_payment_method: paymentMethod,
        hitpay_setup_subscription_id: subscriptionId,
        hitpay_setup_at: new Date().toISOString(),
      },
    });

    console.log(`[HitPay Recurring] Stored recurring billing ID in customer: ${customerId}`);

    return NextResponse.json({
      recurringBillingId: session.id,
      redirectUrl: session.url,
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
