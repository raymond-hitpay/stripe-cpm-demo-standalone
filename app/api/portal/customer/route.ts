/**
 * GET /api/portal/customer
 *
 * Looks up a Stripe customer by email, customer ID, or subscription ID.
 * Used by the customer portal to authenticate by email.
 *
 * @example By email:          GET /api/portal/customer?email=john@example.com
 * @example By ID:             GET /api/portal/customer?customerId=cus_xxx
 * @example By subscription:   GET /api/portal/customer?subscriptionId=sub_xxx
 *
 * @example Response
 * ```json
 * { "id": "cus_xxx", "email": "john@example.com", "name": "John Doe", "metadata": {} }
 * ```
 */
import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import Stripe from 'stripe';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const email = searchParams.get('email');
  const customerId = searchParams.get('customerId');
  const subscriptionId = searchParams.get('subscriptionId');

  if (!email && !customerId && !subscriptionId) {
    return NextResponse.json(
      { error: 'email, customerId, or subscriptionId is required' },
      { status: 400 }
    );
  }

  try {
    if (subscriptionId) {
      // Look up by subscription ID — expands customer inline
      const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
        expand: ['customer'],
      });

      const customer = subscription.customer as Stripe.Customer;

      if (!customer || (customer as unknown as Stripe.DeletedCustomer).deleted) {
        return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
      }

      return NextResponse.json({
        id: customer.id,
        email: customer.email,
        name: customer.name,
        metadata: customer.metadata || {},
      });
    }

    if (customerId) {
      // Look up by Stripe customer ID
      const customer = await stripe.customers.retrieve(customerId);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((customer as any).deleted) {
        return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c = customer as any;
      return NextResponse.json({
        id: c.id,
        email: c.email,
        name: c.name,
        metadata: c.metadata || {},
      });
    }

    // Look up by email
    const customers = await stripe.customers.list({ email: email!, limit: 1 });

    if (customers.data.length === 0) {
      return NextResponse.json(
        { error: 'No account found for this email' },
        { status: 404 }
      );
    }

    const c = customers.data[0];
    return NextResponse.json({
      id: c.id,
      email: c.email,
      name: c.name,
      metadata: c.metadata || {},
    });
  } catch (error) {
    console.error('[Portal Customer] Error:', error);
    return NextResponse.json(
      { error: 'Failed to look up customer' },
      { status: 500 }
    );
  }
}
