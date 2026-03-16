/**
 * Subscription Success Page - Confirmation after successful subscription.
 *
 * Displays subscription confirmation and next steps after a successful
 * subscription payment.
 */
'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

function SubscriptionSuccessContent() {
  const searchParams = useSearchParams();
  const subscriptionId = searchParams.get('subscription_id');
  const paymentIntent = searchParams.get('payment_intent');
  const redirectStatus = searchParams.get('redirect_status');

  // HitPay CPM payment params
  const method = searchParams.get('method');
  const hitpayId = searchParams.get('hitpay_id');

  // Check if payment was successful
  // Success if: Stripe redirect succeeded OR HitPay CPM payment completed
  const isSuccessful = redirectStatus === 'succeeded' || (method && hitpayId);

  if (!isSuccessful) {
    return (
      <div className="max-w-lg mx-auto text-center py-16">
        <div className="bg-white rounded-lg shadow-lg p-8">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto">
            <svg
              className="w-8 h-8 text-red-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </div>

          <h1 className="mt-6 text-2xl font-bold text-gray-900">
            Payment Failed
          </h1>

          <p className="mt-4 text-gray-600">
            Your subscription payment could not be processed. Please try again
            or use a different payment method.
          </p>

          <div className="mt-8">
            <Link
              href="/subscriptions"
              className="px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium"
            >
              Try Again
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto text-center py-16">
      <div className="bg-white rounded-lg shadow-lg p-8">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
          <svg
            className="w-8 h-8 text-green-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 13l4 4L19 7"
            />
          </svg>
        </div>

        <h1 className="mt-6 text-2xl font-bold text-gray-900">
          Subscription Activated!
        </h1>

        <p className="mt-4 text-gray-600">
          Thank you for subscribing! Your subscription is now active and you&apos;ll
          be billed automatically each billing cycle.
        </p>

        <div className="mt-6 bg-indigo-50 border border-indigo-200 rounded-lg p-4">
          <h3 className="font-medium text-indigo-900">What&apos;s Next?</h3>
          <ul className="mt-2 text-sm text-indigo-700 text-left space-y-2">
            <li className="flex items-start gap-2">
              <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clipRule="evenodd"
                />
              </svg>
              <span>You&apos;ll receive a confirmation email shortly</span>
            </li>
            <li className="flex items-start gap-2">
              <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clipRule="evenodd"
                />
              </svg>
              <span>Your card will be charged automatically each billing cycle</span>
            </li>
            <li className="flex items-start gap-2">
              <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clipRule="evenodd"
                />
              </svg>
              <span>You can cancel anytime from your account settings</span>
            </li>
          </ul>
        </div>

        {(subscriptionId || paymentIntent || hitpayId) && (
          <div className="mt-4 text-xs text-gray-500 text-left border-t pt-4">
            {subscriptionId && (
              <p>
                <span className="font-medium">Subscription ID:</span>{' '}
                {subscriptionId}
              </p>
            )}
            {paymentIntent && (
              <p className="mt-1">
                <span className="font-medium">Payment ID:</span>{' '}
                {paymentIntent}
              </p>
            )}
            {hitpayId && (
              <p className="mt-1">
                <span className="font-medium">HitPay Payment:</span>{' '}
                {hitpayId}
              </p>
            )}
            {method && (
              <p className="mt-1">
                <span className="font-medium">Payment Method:</span>{' '}
                {method.charAt(0).toUpperCase() + method.slice(1)}
              </p>
            )}
          </div>
        )}

        <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/"
            className="px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium"
          >
            Continue Shopping
          </Link>
          <Link
            href="/subscriptions"
            className="px-6 py-3 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-medium"
          >
            View More Subscriptions
          </Link>
        </div>

        {/* Customer Portal link */}
        <div className="mt-6 pt-6 border-t">
          <p className="text-sm text-gray-600 mb-3">
            Need to pay a future invoice? Access your Customer Portal anytime.
          </p>
          <Link
            href="/portal"
            className="inline-flex items-center gap-2 text-sm font-medium text-indigo-600 hover:text-indigo-700"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            View your invoices in the Customer Portal
          </Link>
        </div>

        <div className="mt-8 pt-6 border-t">
          <h3 className="text-sm font-semibold text-gray-900">
            About Stripe Billing
          </h3>
          <p className="mt-2 text-xs text-gray-500">
            Your subscription is powered by Stripe Billing, providing secure
            and reliable recurring payments. Stripe will automatically charge
            your saved payment method each billing cycle.
          </p>
        </div>
      </div>
    </div>
  );
}

function LoadingFallback() {
  return (
    <div className="max-w-lg mx-auto text-center py-16">
      <div className="bg-white rounded-lg shadow-lg p-8">
        <div className="animate-pulse">
          <div className="w-16 h-16 bg-gray-200 rounded-full mx-auto"></div>
          <div className="mt-6 h-8 bg-gray-200 rounded w-3/4 mx-auto"></div>
          <div className="mt-4 h-4 bg-gray-200 rounded w-full"></div>
          <div className="mt-2 h-4 bg-gray-200 rounded w-2/3 mx-auto"></div>
        </div>
      </div>
    </div>
  );
}

export default function SubscriptionSuccessPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <SubscriptionSuccessContent />
    </Suspense>
  );
}
