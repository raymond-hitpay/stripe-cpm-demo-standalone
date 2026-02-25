/**
 * GET /api/products
 *
 * Fetches products dynamically from Stripe Dashboard.
 * No need to manually configure price IDs - products created in
 * Stripe Dashboard automatically appear.
 *
 * @example Request
 * ```
 * GET /api/products?type=recurring    // Subscription products
 * GET /api/products?type=one_time     // One-time products
 * GET /api/products                   // All products
 * ```
 *
 * @example Response
 * ```json
 * {
 *   "products": [
 *     {
 *       "id": "prod_xxx",
 *       "name": "Coffee Subscription",
 *       "description": "Fresh roasted coffee...",
 *       "price": 2990,
 *       "currency": "sgd",
 *       "image": "https://...",
 *       "type": "subscription",
 *       "stripePriceId": "price_xxx",
 *       "interval": "month",
 *       "intervalCount": 1
 *     }
 *   ]
 * }
 * ```
 */
import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import Stripe from 'stripe';

interface ProductResponse {
  id: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  image: string;
  type: 'one_time' | 'subscription';
  stripePriceId: string;
  interval?: 'month' | 'year' | 'week' | 'day';
  intervalCount?: number;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const type = searchParams.get('type'); // 'recurring', 'one_time', or null for all

    // Fetch prices with expanded product data
    const pricesParams: Stripe.PriceListParams = {
      active: true,
      limit: 100,
      expand: ['data.product'],
    };

    // Filter by price type if specified
    if (type === 'recurring') {
      pricesParams.type = 'recurring';
    } else if (type === 'one_time') {
      pricesParams.type = 'one_time';
    }

    const prices = await stripe.prices.list(pricesParams);

    // Debug: Log raw prices fetched
    console.log(`[Products API] Raw prices fetched: ${prices.data.length}`);
    prices.data.forEach((price) => {
      const product = price.product as Stripe.Product;
      console.log(`  - Price: ${price.id}, Type: ${price.type}, Amount: ${price.unit_amount}, Product: ${product?.name || 'N/A'}, Active: ${product?.active}`);
    });

    // Map Stripe prices to our Product format
    const products: ProductResponse[] = prices.data
      .filter((price) => {
        // Only include prices with active products
        const product = price.product as Stripe.Product;
        return product && !product.deleted && product.active;
      })
      .map((price) => {
        const product = price.product as Stripe.Product;
        const isRecurring = price.type === 'recurring';

        return {
          id: product.id,
          name: product.name,
          description: product.description || '',
          price: price.unit_amount || 0,
          currency: price.currency,
          image: product.images?.[0] || 'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=400&h=400&fit=crop',
          type: isRecurring ? 'subscription' : 'one_time',
          stripePriceId: price.id,
          ...(isRecurring && price.recurring && {
            interval: price.recurring.interval,
            intervalCount: price.recurring.interval_count,
          }),
        };
      });

    // Sort by name for consistent ordering
    products.sort((a, b) => a.name.localeCompare(b.name));

    console.log(`[Products API] Fetched ${products.length} products (type: ${type || 'all'})`);

    return NextResponse.json({ products });
  } catch (error) {
    console.error('Error fetching products:', error);

    if (error instanceof Error && error.message.includes('Invalid API Key')) {
      return NextResponse.json(
        {
          error: 'Stripe configuration error',
          hint: 'Check that STRIPE_SECRET_KEY is set correctly in .env.local',
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to fetch products' },
      { status: 500 }
    );
  }
}
