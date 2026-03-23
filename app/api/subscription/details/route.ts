import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import Stripe from 'stripe';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const subscriptionId = searchParams.get('subscriptionId');

  if (!subscriptionId) {
    return NextResponse.json({ error: 'subscriptionId is required' }, { status: 400 });
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ['items.data.price.product'],
    }) as any;

    const item = subscription.items.data[0];
    const price = item?.price as Stripe.Price & { product: Stripe.Product };
    const product = price?.product as Stripe.Product;

    return NextResponse.json({
      productName: product?.name ?? null,
      productDescription: product?.description ?? null,
      productImage: product?.images?.[0] ?? null,
      amount: price?.unit_amount ?? null,
      currency: price?.currency ?? null,
      interval: price?.recurring?.interval ?? null,
      intervalCount: price?.recurring?.interval_count ?? null,
      status: subscription.status,
      currentPeriodEnd: subscription.current_period_end,
    });
  } catch (error) {
    console.error('Error fetching subscription details:', error);
    return NextResponse.json({ error: 'Failed to fetch subscription details' }, { status: 500 });
  }
}
