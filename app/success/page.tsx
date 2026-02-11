'use client';

import { Suspense, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useCartStore } from '@/lib/store';

function SuccessContent() {
  const searchParams = useSearchParams();
  const method = searchParams.get('method');
  const paymentId = searchParams.get('payment_id');
  const hitpayId = searchParams.get('hitpay_id');
  const paymentRecordId = searchParams.get('payment_record_id');
  const clearCart = useCartStore((state) => state.clearCart);

  useEffect(() => {
    // Clear the cart after successful payment
    clearCart();
  }, [clearCart]);

  const getPaymentMethodLabel = () => {
    switch (method) {
      case 'card':
        return 'Credit/Debit Card';
      case 'paynow':
        return 'PayNow QR';
      default:
        return 'your selected method';
    }
  };

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
          Payment Successful!
        </h1>

        <p className="mt-4 text-gray-600">
          Thank you for your purchase. Your payment via{' '}
          <span className="font-medium text-indigo-600">
            {getPaymentMethodLabel()}
          </span>{' '}
          has been processed successfully.
        </p>

        {method === 'paynow' && (
          <div className="mt-4 bg-blue-50 border border-blue-200 rounded-lg p-4 text-left">
            <p className="text-sm text-blue-700 mb-3">
              This payment was processed through HitPay as a Custom Payment Method
              integrated with Stripe.
            </p>
            {(paymentId || hitpayId || paymentRecordId) && (
              <div className="text-xs text-blue-600 space-y-1 border-t border-blue-200 pt-2">
                {paymentRecordId && (
                  <p><span className="font-medium">Stripe Payment Record:</span> {paymentRecordId}</p>
                )}
                {paymentId && (
                  <p><span className="font-medium">Stripe PaymentIntent:</span> {paymentId}</p>
                )}
                {hitpayId && (
                  <p><span className="font-medium">HitPay Reference:</span> {hitpayId}</p>
                )}
              </div>
            )}
          </div>
        )}

        {method === 'card' && (
          <div className="mt-4 bg-indigo-50 border border-indigo-200 rounded-lg p-4">
            <p className="text-sm text-indigo-700">
              This payment was processed directly through Stripe using native card
              payment.
            </p>
          </div>
        )}

        <div className="mt-8 space-y-4">
          <p className="text-sm text-gray-500">
            A confirmation email will be sent to your registered email address.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/"
              className="px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium"
            >
              Continue Shopping
            </Link>
          </div>
        </div>

        <div className="mt-8 pt-6 border-t">
          <h3 className="text-sm font-semibold text-gray-900">
            About this Demo
          </h3>
          <p className="mt-2 text-xs text-gray-500">
            This standalone demo showcases Stripe&apos;s Custom Payment Methods
            feature, allowing merchants to integrate third-party payment providers
            (like HitPay PayNow) alongside native Stripe payments within a unified
            checkout experience.
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

export default function SuccessPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <SuccessContent />
    </Suspense>
  );
}
