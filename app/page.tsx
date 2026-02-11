import { ProductCard } from '@/components/ProductCard';
import { products } from '@/lib/store';

export default function Home() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Our Products</h1>
        <p className="text-gray-500 mt-2">
          Browse our collection of premium artisan goods
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {products.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>

      <div className="mt-12 p-6 bg-indigo-50 rounded-lg">
        <h2 className="text-lg font-semibold text-indigo-900">
          Stripe Custom Payment Methods Demo (Standalone)
        </h2>
        <p className="text-indigo-700 mt-2">
          This demo showcases a standalone integration with Stripe&apos;s Custom Payment Methods
          feature. At checkout, you can pay with:
        </p>
        <ul className="mt-3 space-y-2 text-indigo-700">
          <li className="flex items-center gap-2">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                clipRule="evenodd"
              />
            </svg>
            <span><strong>Credit/Debit Card</strong> - Native Stripe payment</span>
          </li>
          <li className="flex items-center gap-2">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                clipRule="evenodd"
              />
            </svg>
            <span><strong>PayNow QR</strong> - Via HitPay (Custom Payment Method)</span>
          </li>
        </ul>
      </div>
    </div>
  );
}
