/**
 * Checkout Page - Integrates Stripe Elements with Custom Payment Methods.
 *
 * This page demonstrates how to set up Stripe Elements with a Custom Payment
 * Method Type (CPM) for HitPay PayNow integration.
 *
 * Key Concepts:
 *
 * 1. **Custom Payment Methods are client-side configured**
 *    Unlike regular payment methods, CPM types are NOT set via payment_method_types
 *    in PaymentIntent. They are configured via the customPaymentMethods option in
 *    the Elements provider.
 *
 * 2. **Beta flag required**
 *    Stripe.js must be loaded with the 'custom_payment_methods_beta_1' beta flag
 *    (see /lib/stripe-client.ts).
 *
 * 3. **CPM Type ID**
 *    You must create a Custom Payment Method Type in your Stripe Dashboard and
 *    use its ID (cpmt_xxx) here. The PayNow option won't appear if the ID is
 *    invalid or the CPM type is not enabled.
 *
 * @see https://docs.stripe.com/custom-payment-methods/quickstart
 * @see /lib/stripe-client.ts - Stripe.js loader with beta flag
 * @see /components/CheckoutForm.tsx - Payment form with QR code handling
 */
'use client';

import { useEffect, useState, useRef } from 'react';
import { Elements } from '@stripe/react-stripe-js';
import { useCartStore } from '@/lib/store';
import { stripePromise } from '@/lib/stripe-client';
import { CheckoutForm } from '@/components/CheckoutForm';
import Link from 'next/link';
import Image from 'next/image';
import { CUSTOM_PAYMENT_METHODS, getAllCpmTypeIds } from '@/config/payment-methods';

// =============================================================================
// COMPONENT
// =============================================================================

export default function CheckoutPage() {
  const [mounted, setMounted] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [paymentIntentId, setPaymentIntentId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { items, getTotal } = useCartStore();

  // Ref to prevent duplicate payment creation (React StrictMode runs effects twice)
  const hasCreatedPayment = useRef(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  /**
   * Effect: Create PaymentIntent when the page loads.
   *
   * Uses a ref to prevent duplicate API calls in React StrictMode,
   * which runs effects twice in development.
   */
  useEffect(() => {
    if (!mounted || items.length === 0) {
      setIsLoading(false);
      return;
    }

    // Prevent duplicate API calls (React StrictMode runs effects twice)
    if (hasCreatedPayment.current) {
      return;
    }

    const createPayment = async () => {
      hasCreatedPayment.current = true;
      setIsLoading(true);
      try {
        const response = await fetch('/api/create-payment-intent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount: getTotal(),
            currency: 'sgd',
          }),
        });

        const data = await response.json();

        if (data.error) {
          setError(data.error);
        } else {
          setClientSecret(data.clientSecret);
          setPaymentIntentId(data.paymentIntentId);
          console.log('[Checkout] Payment created:', data.paymentIntentId);
        }
      } catch (err) {
        console.error('Error creating payment:', err);
        setError('Failed to initialize checkout');
      } finally {
        setIsLoading(false);
      }
    };

    createPayment();
  }, [mounted, items.length, getTotal]);

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('en-SG', {
      style: 'currency',
      currency: 'SGD',
    }).format(price / 100);
  };

  // Show loading spinner until client-side hydration completes
  if (!mounted) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  // Empty cart state
  if (items.length === 0) {
    return (
      <div className="text-center py-16">
        <h2 className="text-xl font-semibold text-gray-900">
          Your cart is empty
        </h2>
        <p className="mt-2 text-gray-500">Add some products before checkout.</p>
        <Link
          href="/"
          className="mt-6 inline-block bg-indigo-600 text-white px-6 py-3 rounded-lg hover:bg-indigo-700 transition-colors"
        >
          Continue Shopping
        </Link>
      </div>
    );
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto"></div>
          <p className="mt-3 text-sm text-gray-600">Initializing payment...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="max-w-lg mx-auto text-center py-16">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6">
          <h2 className="text-xl font-semibold text-red-900">Checkout Error</h2>
          <p className="mt-2 text-red-600">{error}</p>
          <Link
            href="/"
            className="mt-4 inline-block bg-red-600 text-white px-6 py-2 rounded-lg hover:bg-red-700"
          >
            Back to Home
          </Link>
        </div>
      </div>
    );
  }

  /**
   * Elements options with Custom Payment Methods configuration.
   *
   * The customPaymentMethods array configures which CPM types to show
   * in the Payment Element. Each entry needs:
   * - id: The CPM Type ID from Stripe Dashboard
   * - options.type: 'static' (placeholder) or 'embedded' (custom content)
   *
   * The 'static' type shows a placeholder with the CPM's configured display name.
   * The 'embedded' type allows custom content but requires Stripe approval.
   *
   * Note: We use 'as any' because the customPaymentMethods property is part of
   * a beta API and may not be in the official TypeScript definitions yet.
   */
  const cpmTypeIds = getAllCpmTypeIds();
  const elementsOptions = clientSecret
    ? {
        clientSecret,
        appearance: {
          theme: 'stripe' as const,
        },
        // Configure all Custom Payment Methods to show in Payment Element
        customPaymentMethods: CUSTOM_PAYMENT_METHODS.map((pm) => ({
          id: pm.id,
          options: {
            // 'static' shows placeholder text; 'embedded' allows custom content
            type: 'static' as const,
          },
        })),
        // Show custom payment methods first, then card
        paymentMethodOrder: [...cpmTypeIds, 'card'],
      }
    : null;

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold text-gray-900 mb-8">Checkout</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Order Summary */}
        <div className="order-2 lg:order-1">
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Order Summary
            </h2>
            <div className="space-y-4">
              {items.map((item) => (
                <div key={item.id} className="flex gap-3">
                  <div className="relative w-16 h-16 flex-shrink-0 bg-gray-100 rounded-lg overflow-hidden">
                    <Image
                      src={item.image}
                      alt={item.name}
                      fill
                      className="object-cover"
                      sizes="64px"
                    />
                  </div>
                  <div className="flex-grow">
                    <p className="font-medium text-gray-900 text-sm">
                      {item.name}
                    </p>
                    <p className="text-gray-500 text-sm">Qty: {item.quantity}</p>
                  </div>
                  <p className="font-medium text-gray-900 text-sm">
                    {formatPrice(item.price * item.quantity)}
                  </p>
                </div>
              ))}
            </div>
            <div className="border-t mt-4 pt-4">
              <div className="flex justify-between text-lg font-semibold">
                <span>Total</span>
                <span className="text-indigo-600">{formatPrice(getTotal())}</span>
              </div>
            </div>
          </div>

          {/* Demo Info */}
          <div className="mt-4 bg-gray-50 border border-gray-200 rounded-lg p-4">
            <h3 className="font-medium text-gray-900 text-sm">
              Standalone Integration
            </h3>
            <ul className="mt-2 text-xs text-gray-600 space-y-1">
              <li>• PaymentIntent created on your Stripe account</li>
              <li>• Custom Payment Method Type configured on your account</li>
              <li>• HitPay QR embedded in Payment Element</li>
              <li>• Payment Record created on your account</li>
            </ul>
          </div>
        </div>

        {/* Payment Section */}
        <div className="order-1 lg:order-2">
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Payment Method
            </h2>

            {/* Stripe Elements with Custom Payment Methods */}
            {clientSecret && paymentIntentId && stripePromise && elementsOptions && (
              <Elements
                stripe={stripePromise}
                options={elementsOptions as any} // Type assertion for beta API
                key={paymentIntentId} // Re-mount on new PaymentIntent
              >
                <CheckoutForm
                  amount={getTotal()}
                  paymentIntentId={paymentIntentId}
                />
              </Elements>
            )}
          </div>

          {/* Security Badge */}
          <div className="mt-4 flex items-center justify-center gap-2 text-sm text-gray-500">
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
            <span>Secure payment via Stripe</span>
          </div>
        </div>
      </div>
    </div>
  );
}
