/**
 * Customer Portal - Email Login Page
 *
 * Simple email-based "login" to access invoice history.
 * No session auth needed for this demo — customer ID passed in URL.
 */
'use client';

import { useState, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

function PortalLoginContent() {
  const router = useRouter();
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    const value = input.trim();
    let url: string;
    if (value.startsWith('sub_')) {
      url = `/api/portal/customer?subscriptionId=${encodeURIComponent(value)}`;
    } else if (value.startsWith('cus_')) {
      url = `/api/portal/customer?customerId=${encodeURIComponent(value)}`;
    } else {
      url = `/api/portal/customer?email=${encodeURIComponent(value)}`;
    }

    try {
      const res = await fetch(url);
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'No account found');
        return;
      }

      router.push(`/portal/invoices?customerId=${data.id}`);
    } catch {
      setError('Failed to look up account. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto py-16 px-4">
      <div className="mb-6">
        <Link
          href="/"
          className="text-indigo-600 hover:text-indigo-700 text-sm font-medium"
        >
          &larr; Back to Home
        </Link>
      </div>

      <div className="bg-white rounded-xl shadow-lg p-8">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-indigo-100 rounded-full flex items-center justify-center mx-auto">
            <svg
              className="w-8 h-8 text-indigo-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
          </div>
          <h1 className="mt-4 text-2xl font-bold text-gray-900">
            Customer Portal
          </h1>
          <p className="mt-2 text-gray-600">
            Enter your subscription ID or email to view and pay your invoices.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="input"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Subscription ID or Email
            </label>
            <input
              type="text"
              id="input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="sub_xxx or john@example.com"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-colors"
              disabled={isLoading}
              required
            />
            <p className="mt-1 text-xs text-gray-500">
              Enter your subscription ID (sub_xxx) from your confirmation email, or your email address
            </p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-red-700 text-sm font-medium">{error}</p>
              {error.toLowerCase().includes('no account found') && (
                <div className="mt-2 pt-2 border-t border-red-200">
                  <p className="text-red-600 text-sm">
                    If you have a subscription, try entering your{' '}
                    <strong>subscription ID</strong> instead (starts with{' '}
                    <code className="bg-red-100 px-1 rounded text-xs">sub_</code>).
                  </p>
                  <p className="mt-1 text-red-500 text-xs">
                    You can find your subscription ID in your confirmation email.
                  </p>
                </div>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="w-full bg-indigo-600 text-white py-3 rounded-lg hover:bg-indigo-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <span className="flex items-center justify-center gap-2">
                <svg
                  className="animate-spin h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Looking up...
              </span>
            ) : (
              'Find My Invoices'
            )}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-gray-500">
          Use the subscription ID (sub_xxx) or email from your subscription confirmation.
        </p>
      </div>
    </div>
  );
}

function LoadingFallback() {
  return (
    <div className="max-w-md mx-auto py-16 px-4">
      <div className="bg-white rounded-xl shadow-lg p-8 animate-pulse">
        <div className="w-16 h-16 bg-gray-200 rounded-full mx-auto" />
        <div className="mt-4 h-8 bg-gray-200 rounded w-3/4 mx-auto" />
        <div className="mt-8 h-10 bg-gray-200 rounded" />
        <div className="mt-4 h-12 bg-gray-200 rounded" />
      </div>
    </div>
  );
}

export default function PortalPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <PortalLoginContent />
    </Suspense>
  );
}
