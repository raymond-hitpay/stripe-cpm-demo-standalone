'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ProductCard } from '@/components/ProductCard';
import { CartIcon } from '@/components/CartIcon';
import { products } from '@/lib/store';
import { Product } from '@/lib/store';

type Tab = 'one_time' | 'subscriptions';

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<Tab>('one_time');
  const [subProducts, setSubProducts] = useState<Product[]>([]);
  const [subLoading, setSubLoading] = useState(false);
  const [subLoaded, setSubLoaded] = useState(false);

  useEffect(() => {
    if (activeTab === 'subscriptions' && !subLoaded) {
      setSubLoading(true);
      fetch('/api/products?type=recurring')
        .then((res) => res.json())
        .then((data) => {
          setSubProducts(data.products ?? []);
          setSubLoaded(true);
        })
        .catch(() => setSubProducts([]))
        .finally(() => setSubLoading(false));
    }
  }, [activeTab, subLoaded]);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top bar */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Stripe CPM Demo</h1>
            <p className="text-xs text-gray-500 hidden sm:block">Custom Payment Methods · HitPay Integration</p>
          </div>
          <div className="flex items-center gap-3">
            <CartIcon />
            <Link
              href="/portal"
              title="Customer Portal"
              className="p-2 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        {/* Tab bar */}
        <div className="flex gap-1 border-b border-gray-200 mb-8">
          <button
            onClick={() => setActiveTab('one_time')}
            className={`px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === 'one_time'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            One-time payments
          </button>
          <button
            onClick={() => setActiveTab('subscriptions')}
            className={`px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === 'subscriptions'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Subscriptions
          </button>
        </div>

        {/* One-time payments tab */}
        {activeTab === 'one_time' && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {products.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
            <div className="mt-8 bg-indigo-50 rounded-lg p-4 text-sm text-indigo-700">
              At checkout, pay with Card or PayNow QR (Custom Payment Method). Cart is at{' '}
              <Link href="/shop/cart" className="underline font-medium">
                /shop/cart
              </Link>
              .
            </div>
          </>
        )}

        {/* Subscriptions tab */}
        {activeTab === 'subscriptions' && (
          <>
            {subLoading ? (
              <div className="flex items-center justify-center py-20">
                <svg className="animate-spin w-8 h-8 text-indigo-600" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              </div>
            ) : subProducts.length === 0 ? (
              <div className="text-center py-20">
                <p className="text-gray-500 text-lg">No subscription products found.</p>
                <p className="text-gray-400 text-sm mt-2">
                  Create a recurring product in your{' '}
                  <span className="font-medium">Stripe Dashboard → Products</span>.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {subProducts.map((product) => (
                  <ProductCard key={product.id} product={product} />
                ))}
              </div>
            )}
            <div className="mt-8 bg-purple-50 rounded-lg p-4 text-sm text-purple-700">
              Automatic billing · Cancel anytime. Supports out-of-band invoice payment and auto-charge via HitPay.
            </div>
          </>
        )}
      </main>
    </div>
  );
}
