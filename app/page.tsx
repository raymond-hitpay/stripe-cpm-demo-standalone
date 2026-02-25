import Link from 'next/link';

export default function LandingPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center">
      {/* Header */}
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold text-gray-900">
          Stripe CPM Demo
        </h1>
        <p className="mt-3 text-lg text-gray-600">
          Choose your payment experience
        </p>
      </div>

      {/* Flow Selection Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl w-full px-4">
        {/* One-Time Payments Card */}
        <Link
          href="/shop"
          className="group bg-white rounded-xl shadow-lg border-2 border-transparent hover:border-indigo-500 transition-all p-8 flex flex-col"
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 bg-indigo-100 rounded-lg flex items-center justify-center group-hover:bg-indigo-200 transition-colors">
              <svg
                className="w-6 h-6 text-indigo-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"
                />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-gray-900">One-Time Payments</h2>
          </div>

          <p className="text-gray-600 mb-6 flex-grow">
            Browse products, add to cart, and checkout with card or PayNow via
            Stripe Custom Payment Methods.
          </p>

          <ul className="text-sm text-gray-500 space-y-2 mb-6">
            <li className="flex items-center gap-2">
              <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
              Shopping cart experience
            </li>
            <li className="flex items-center gap-2">
              <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
              Card + PayNow (CPM) support
            </li>
            <li className="flex items-center gap-2">
              <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
              QR code payment flow
            </li>
          </ul>

          <div className="flex items-center text-indigo-600 font-medium group-hover:text-indigo-700">
            Browse Products
            <svg className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
          </div>
        </Link>

        {/* Subscriptions Card */}
        <Link
          href="/subscriptions"
          className="group bg-white rounded-xl shadow-lg border-2 border-transparent hover:border-purple-500 transition-all p-8 flex flex-col"
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center group-hover:bg-purple-200 transition-colors">
              <svg
                className="w-6 h-6 text-purple-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-gray-900">Subscriptions</h2>
          </div>

          <p className="text-gray-600 mb-6 flex-grow">
            Subscribe to recurring plans with automatic billing powered by
            Stripe Billing.
          </p>

          <ul className="text-sm text-gray-500 space-y-2 mb-6">
            <li className="flex items-center gap-2">
              <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
              Direct checkout (no cart)
            </li>
            <li className="flex items-center gap-2">
              <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
              Recurring card payments
            </li>
            <li className="flex items-center gap-2">
              <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
              Products from Stripe Dashboard
            </li>
          </ul>

          <div className="flex items-center text-purple-600 font-medium group-hover:text-purple-700">
            View Plans
            <svg className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
          </div>
        </Link>
      </div>

      {/* Demo Info */}
      <div className="mt-12 max-w-2xl mx-auto px-4">
        <div className="bg-indigo-50 rounded-lg p-6 text-center">
          <h3 className="font-semibold text-indigo-900">
            Stripe Custom Payment Methods Demo
          </h3>
          <p className="mt-2 text-sm text-indigo-700">
            This demo showcases Stripe&apos;s Custom Payment Methods feature, integrating
            HitPay PayNow alongside native Stripe payments in a unified checkout experience.
          </p>
        </div>
      </div>
    </div>
  );
}
