/**
 * Subscriptions Page - Lists subscription products from Stripe.
 *
 * This page fetches subscription products dynamically from Stripe Dashboard.
 * Products with recurring prices are automatically displayed here.
 */
import { ProductCard } from '@/components/ProductCard';
import { Product } from '@/lib/store';
import Link from 'next/link';
import { stripe } from '@/lib/stripe';
import Stripe from 'stripe';

// Fetch subscription products directly from Stripe SDK
async function getSubscriptionProducts(): Promise<Product[]> {
  try {
    const prices = await stripe.prices.list({
      active: true,
      type: 'recurring',
      limit: 100,
      expand: ['data.product'],
    });

    return prices.data
      .filter((price) => {
        const product = price.product as Stripe.Product;
        return product && !product.deleted && product.active;
      })
      .map((price) => {
        const product = price.product as Stripe.Product;
        return {
          id: product.id,
          name: product.name,
          description: product.description || '',
          price: price.unit_amount || 0,
          currency: price.currency,
          image: product.images?.[0] || 'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=400&h=400&fit=crop',
          type: 'subscription' as const,
          stripePriceId: price.id,
          ...(price.recurring && {
            interval: price.recurring.interval,
            intervalCount: price.recurring.interval_count,
          }),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    console.error('Error fetching subscription products:', error);
    return [];
  }
}

export default async function SubscriptionsPage() {
  const subscriptionProducts = await getSubscriptionProducts();

  return (
    <div>
      <div className="mb-8">
        <Link
          href="/"
          className="text-purple-600 hover:text-purple-700 text-sm font-medium"
        >
          &larr; Back to Home
        </Link>
        <h1 className="text-3xl font-bold text-gray-900 mt-4">Subscriptions</h1>
        <p className="text-gray-500 mt-2">
          Subscribe and save with regular deliveries of our premium goods
        </p>
      </div>

      {subscriptionProducts.length === 0 ? (
        <div className="text-center py-16">
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 max-w-lg mx-auto">
            <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
            <h2 className="text-lg font-semibold text-gray-900">
              No Subscriptions Available
            </h2>
            <p className="mt-2 text-gray-600 text-sm">
              Subscription products are fetched directly from your Stripe Dashboard.
            </p>
            <div className="mt-4 p-4 bg-indigo-50 rounded-lg text-left">
              <p className="text-sm font-medium text-indigo-900 mb-2">To add subscriptions:</p>
              <ol className="text-xs text-indigo-700 space-y-1 list-decimal list-inside">
                <li>Go to Stripe Dashboard &rarr; Products</li>
                <li>Create a new product</li>
                <li>Set pricing to &quot;Recurring&quot; (monthly/yearly)</li>
                <li>Products will automatically appear here</li>
              </ol>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {subscriptionProducts.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}

      <div className="mt-12 p-6 bg-indigo-50 rounded-lg">
        <h2 className="text-lg font-semibold text-indigo-900">
          How Subscriptions Work
        </h2>
        <p className="text-indigo-700 mt-2">
          Our subscriptions use Stripe Billing for secure, automatic recurring payments:
        </p>
        <ul className="mt-3 space-y-2 text-indigo-700">
          <li className="flex items-center gap-2">
            <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                clipRule="evenodd"
              />
            </svg>
            <span><strong>Automatic billing</strong> - Your card is charged each billing cycle</span>
          </li>
          <li className="flex items-center gap-2">
            <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                clipRule="evenodd"
              />
            </svg>
            <span><strong>Cancel anytime</strong> - No long-term commitments</span>
          </li>
        </ul>
      </div>
    </div>
  );
}
