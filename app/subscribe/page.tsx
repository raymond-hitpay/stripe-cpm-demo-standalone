/**
 * Subscribe Page - Checkout for subscription products.
 *
 * This page handles the subscription checkout flow:
 * 1. Gets priceId from URL params
 * 2. Fetches product details from Stripe
 * 3. Collects customer details (email, name)
 * 4. Creates a Stripe Subscription (incomplete state)
 * 5. Displays Payment Element for card input
 * 6. Confirms payment and activates subscription
 *
 * @see /app/api/create-subscription/route.ts - Creates subscription
 * @see /components/SubscriptionCheckoutForm.tsx - Payment form
 */
'use client';

import { useEffect, useState, useRef, Suspense } from 'react';
import { Elements } from '@stripe/react-stripe-js';
import { useSearchParams } from 'next/navigation';
import { stripePromise } from '@/lib/stripe-client';
import { SubscriptionCheckoutForm } from '@/components/SubscriptionCheckoutForm';
import { AutoChargePaymentElement } from '@/components/AutoChargePaymentElement';
import { Product } from '@/lib/store';
import Link from 'next/link';
import Image from 'next/image';
import {
  getOneTimeCpms,
  getOneTimeCpmTypeIds,
  getAutoChargeCpms,
  getAutoChargeCpmTypeIds,
} from '@/config/payment-methods';
import { CpmDisplayType } from '@/components/CpmDisplayToggle';

export type BillingType = 'out_of_band' | 'charge_automatically';

// =============================================================================
// SUBSCRIBE CONTENT COMPONENT
// =============================================================================

function SubscribeContent() {
  const searchParams = useSearchParams();
  const priceId = searchParams.get('priceId');

  // Customer details state
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [detailsSubmitted, setDetailsSubmitted] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);

  // Billing type state
  const [billingType, setBillingType] = useState<BillingType>('charge_automatically');

  // CPM display type: always use 'embedded' for demo
  const [displayType] = useState<CpmDisplayType>('embedded');

  // Container ref for embedded mode
  const embeddedContainerRef = useRef<HTMLElement | null>(null);
  const [embeddedContainerKey, setEmbeddedContainerKey] = useState(0);

  // Subscription state
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [subscriptionId, setSubscriptionId] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  const [invoiceAmount, setInvoiceAmount] = useState<number>(0);
  const [invoiceCurrency, setInvoiceCurrency] = useState<string>('sgd');
  const [product, setProduct] = useState<Product | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreatingSubscription, setIsCreatingSubscription] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ref to prevent duplicate subscription creation
  const hasCreatedSubscription = useRef(false);

  // Get available CPMs based on billing type
  const autoChargeCpms = getAutoChargeCpms();
  const hasAutoChargeCpms = autoChargeCpms.length > 0;

  // Check if form is valid for submission
  const isFormValid = customerEmail.trim() !== '' && customerName.trim() !== '';

  /**
   * Generates random customer details for testing.
   * Uses random first/last names and yopmail.com for email.
   */
  const prefillCustomerDetails = () => {
    const firstNames = ['John', 'Jane', 'Alex', 'Sam', 'Chris', 'Taylor', 'Jordan', 'Morgan', 'Casey', 'Riley'];
    const lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Wilson', 'Lee'];

    const randomFirst = firstNames[Math.floor(Math.random() * firstNames.length)];
    const randomLast = lastNames[Math.floor(Math.random() * lastNames.length)];
    const randomName = `${randomFirst} ${randomLast}`;

    // Generate random email with timestamp for uniqueness
    const timestamp = Date.now().toString(36);
    const randomEmail = `test_${randomFirst.toLowerCase()}_${timestamp}@yopmail.com`;

    setCustomerName(randomName);
    setCustomerEmail(randomEmail);
  };

  /**
   * Effect: Fetch product details when page loads.
   */
  useEffect(() => {
    if (!priceId) {
      setError('No price selected');
      setIsLoading(false);
      return;
    }

    const fetchProduct = async () => {
      try {
        const productsResponse = await fetch(`/api/products?type=recurring`);
        if (productsResponse.ok) {
          const productsData = await productsResponse.json();
          const matchingProduct = productsData.products?.find(
            (p: Product) => p.stripePriceId === priceId
          );
          if (matchingProduct) {
            setProduct(matchingProduct);
          }
        }
      } catch (err) {
        console.error('Error fetching product:', err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchProduct();
  }, [priceId]);

  /**
   * Handles customer details form submission.
   * Creates the subscription after collecting details.
   */
  const handleDetailsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setDetailsError(null);

    // Validation
    if (!customerEmail.trim()) {
      setDetailsError('Please enter your email address');
      return;
    }
    if (!customerName.trim()) {
      setDetailsError('Please enter your name');
      return;
    }

    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(customerEmail)) {
      setDetailsError('Please enter a valid email address');
      return;
    }

    // Note: For auto-charge, CPM selection now happens after form submission
    // via the Payment Element, so we don't validate selectedCpmTypeId here

    // Prevent duplicate API calls
    if (hasCreatedSubscription.current) {
      return;
    }

    setIsCreatingSubscription(true);
    hasCreatedSubscription.current = true;

    try {
      // Create the subscription with customer details and billing type
      // Note: For auto-charge, CPM selection happens after via Payment Element
      const response = await fetch('/api/create-subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          priceId,
          email: customerEmail.trim(),
          name: customerName.trim(),
          billingType,
        }),
      });

      const data = await response.json();

      if (data.error) {
        setDetailsError(data.error + (data.hint ? ` (${data.hint})` : ''));
        hasCreatedSubscription.current = false;
      } else {
        setSubscriptionId(data.subscriptionId);
        setCustomerId(data.customerId);
        setInvoiceId(data.invoiceId);

        if (data.billingType === 'charge_automatically') {
          // Auto-charge flow: Show Payment Element, then redirect to HitPay
          setInvoiceAmount(data.invoiceAmount);
          setInvoiceCurrency(data.invoiceCurrency);
          setClientSecret(data.clientSecret); // For Payment Element CPM selection
          setDetailsSubmitted(true);
          console.log('[Subscribe] Auto-charge subscription created:', data.subscriptionId, 'with clientSecret');
        } else {
          // Out-of-band flow: Use Payment Element
          setClientSecret(data.clientSecret);
          setDetailsSubmitted(true);
          console.log('[Subscribe] Out-of-band subscription created:', data.subscriptionId, 'Invoice:', data.invoiceId);
        }
      }
    } catch (err) {
      console.error('Error creating subscription:', err);
      setDetailsError('Failed to create subscription. Please try again.');
      hasCreatedSubscription.current = false;
    } finally {
      setIsCreatingSubscription(false);
    }
  };

  const formatPrice = (price: number, currency: string = 'SGD') => {
    return new Intl.NumberFormat('en-SG', {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(price / 100);
  };

  // No price selected
  if (!priceId) {
    return (
      <div className="max-w-lg mx-auto text-center py-16">
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6">
          <h2 className="text-xl font-semibold text-yellow-900">
            No Subscription Selected
          </h2>
          <p className="mt-2 text-yellow-700">
            Please select a subscription plan from our offerings.
          </p>
          <Link
            href="/subscriptions"
            className="mt-4 inline-block bg-purple-600 text-white px-6 py-2 rounded-lg hover:bg-purple-700"
          >
            View Subscriptions
          </Link>
        </div>
      </div>
    );
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mx-auto"></div>
          <p className="mt-3 text-sm text-gray-600">
            Loading subscription details...
          </p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="max-w-lg mx-auto text-center py-16">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6">
          <h2 className="text-xl font-semibold text-red-900">
            Subscription Error
          </h2>
          <p className="mt-2 text-red-600">{error}</p>
          <Link
            href="/subscriptions"
            className="mt-4 inline-block bg-red-600 text-white px-6 py-2 rounded-lg hover:bg-red-700"
          >
            Back to Subscriptions
          </Link>
        </div>
      </div>
    );
  }

  // Elements options for Stripe with Custom Payment Methods (one-time payment methods for out-of-band billing)
  const oneTimeCpms = getOneTimeCpms();
  const oneTimeCpmTypeIds = getOneTimeCpmTypeIds();

  /**
   * Build customPaymentMethods config based on display type.
   * Uses one-time CPMs for out-of-band billing (pay each invoice).
   */
  const buildSubscriptionCpmConfig = () => {
    return oneTimeCpms.map((pm) => {
      if (displayType === 'embedded') {
        return {
          id: pm.id,
          options: {
            type: 'embedded' as const,
            subtitle: 'Scan to pay',
            embedded: {
              handleRender: (container: HTMLElement) => {
                console.log('[Embedded] handleRender called for', pm.displayName);
                embeddedContainerRef.current = container;
                setEmbeddedContainerKey((k) => k + 1);
              },
              handleDestroy: () => {
                console.log('[Embedded] handleDestroy called for', pm.displayName);
                // Don't null the container here - rapid clicks cause destroy/render cycles
                // The portal visibility is controlled by isCustomPaymentSelected in CheckoutForm
              },
            },
          },
        };
      }
      return {
        id: pm.id,
        options: {
          type: 'static' as const,
        },
      };
    });
  };

  const elementsOptions = clientSecret
    ? {
        clientSecret,
        appearance: {
          theme: 'stripe' as const,
        },
        // Configure one-time Custom Payment Methods for out-of-band billing
        customPaymentMethods: buildSubscriptionCpmConfig(),
        // Show card first, then custom payment methods
        paymentMethodOrder: ['card', ...oneTimeCpmTypeIds],
      }
    : null;

  // Default values if product couldn't be fetched
  const productName = product?.name || 'Subscription';
  const productDescription = product?.description || '';
  const productPrice = product?.price || 0;
  const productCurrency = product?.currency || 'sgd';
  const productInterval = product?.interval || 'month';
  const productImage = product?.image || 'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=400&h=400&fit=crop';

  return (
    <div className="max-w-4xl mx-auto">
      <Link
        href="/subscriptions"
        className="text-purple-600 hover:text-purple-700 text-sm font-medium"
      >
        &larr; Back to Plans
      </Link>

      <h1 className="text-3xl font-bold text-gray-900 mt-4 mb-8">
        Complete Your Subscription
      </h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Subscription Summary */}
        <div className="order-2 lg:order-1">
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Subscription Details
            </h2>

            <div className="flex gap-4">
              <div className="relative w-24 h-24 flex-shrink-0 bg-gray-100 rounded-lg overflow-hidden">
                <Image
                  src={productImage}
                  alt={productName}
                  fill
                  className="object-cover"
                  sizes="96px"
                />
              </div>
              <div>
                <h3 className="font-medium text-gray-900">{productName}</h3>
                {productDescription && (
                  <p className="text-gray-500 text-sm mt-1 line-clamp-2">
                    {productDescription}
                  </p>
                )}
                <p className="mt-2 text-lg font-bold text-purple-600">
                  {formatPrice(productPrice, productCurrency)}
                  <span className="text-sm font-normal text-gray-500">
                    /{productInterval === 'month' ? 'mo' : productInterval === 'year' ? 'yr' : productInterval}
                  </span>
                </p>
              </div>
            </div>

            <div className="mt-6 pt-4 border-t">
              <div className="flex justify-between items-center">
                <span className="text-gray-600">Billing</span>
                <span className="font-medium text-gray-900 capitalize">
                  {productInterval === 'month' ? 'Monthly' : productInterval === 'year' ? 'Yearly' : productInterval}
                </span>
              </div>
              <div className="flex justify-between items-center mt-2">
                <span className="text-gray-600">First payment</span>
                <span className="font-medium text-gray-900">Today</span>
              </div>
            </div>
          </div>

          {/* Demo Info */}
          <div className="mt-4 bg-gray-50 border border-gray-200 rounded-lg p-4">
            <h3 className="font-medium text-gray-900 text-sm">
              Subscription Billing Types
            </h3>
            <div className="mt-2 space-y-3">
              <div>
                <p className="text-xs font-medium text-gray-700">Pay Each Invoice (Out-of-Band)</p>
                <ul className="mt-1 text-xs text-gray-600 space-y-0.5">
                  <li>- Pay via QR code or checkout link each billing cycle</li>
                  <li>- Works with all payment methods (PayNow, ShopeePay, etc.)</li>
                  <li>- Invoice marked as paid after external payment</li>
                </ul>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-700">Auto-Charge (Own Processor)</p>
                <ul className="mt-1 text-xs text-gray-600 space-y-0.5">
                  <li>- Save payment method for automatic billing</li>
                  <li>- HitPay charges saved method each cycle</li>
                  <li>- Requires methods with tokenization (ShopeePay, GrabPay)</li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        {/* Checkout Section */}
        <div className="order-1 lg:order-2">
          <div className="bg-white rounded-lg shadow-md p-6">
            {!detailsSubmitted ? (
              <>
                {/* Customer Details Form */}
                <h2 className="text-lg font-semibold text-gray-900 mb-4">
                  Your Details
                </h2>
                <form onSubmit={handleDetailsSubmit} className="space-y-4">
                  <div>
                    <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
                      Full Name
                    </label>
                    <input
                      type="text"
                      id="name"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      placeholder="John Doe"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none transition-colors"
                      disabled={isCreatingSubscription}
                    />
                  </div>

                  <div>
                    <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                      Email Address
                    </label>
                    <input
                      type="email"
                      id="email"
                      value={customerEmail}
                      onChange={(e) => setCustomerEmail(e.target.value)}
                      placeholder="john@example.com"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none transition-colors"
                      disabled={isCreatingSubscription}
                    />
                  </div>

                  {/* Prefill button for testing */}
                  <button
                    type="button"
                    onClick={prefillCustomerDetails}
                    disabled={isCreatingSubscription}
                    className="text-sm text-purple-600 hover:text-purple-700 underline disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Prefill for me (testing)
                  </button>

                  {/* Billing Type Toggle */}
                  <div className="pt-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Billing Type
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      {/* Auto-Charge Option */}
                      <button
                        type="button"
                        onClick={() => setBillingType('charge_automatically')}
                        disabled={isCreatingSubscription || !hasAutoChargeCpms}
                        className={`p-3 rounded-lg border-2 text-left transition-all ${
                          billingType === 'charge_automatically'
                            ? 'border-purple-500 bg-purple-50'
                            : 'border-gray-200 hover:border-gray-300'
                        } ${isCreatingSubscription || !hasAutoChargeCpms ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        <div className="font-medium text-gray-900 text-sm">
                          Auto-Charge
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          {hasAutoChargeCpms
                            ? 'Save payment method for automatic billing'
                            : 'No auto-charge methods available'}
                        </div>
                      </button>

                      {/* Out-of-Band Option */}
                      <button
                        type="button"
                        onClick={() => setBillingType('out_of_band')}
                        disabled={isCreatingSubscription}
                        className={`p-3 rounded-lg border-2 text-left transition-all ${
                          billingType === 'out_of_band'
                            ? 'border-purple-500 bg-purple-50'
                            : 'border-gray-200 hover:border-gray-300'
                        } ${isCreatingSubscription ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        <div className="font-medium text-gray-900 text-sm">
                          Pay Each Invoice
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          Pay via QR code each billing cycle
                        </div>
                      </button>
                    </div>
                  </div>

                  {detailsError && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                      <p className="text-red-600 text-sm">{detailsError}</p>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={isCreatingSubscription || !isFormValid}
                    className="w-full bg-purple-600 text-white py-3 rounded-lg hover:bg-purple-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isCreatingSubscription ? (
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
                        Setting up...
                      </span>
                    ) : (
                      'Continue to Payment'
                    )}
                  </button>
                </form>
              </>
            ) : (
              <>
                {/* Payment Details */}
                <h2 className="text-lg font-semibold text-gray-900 mb-4">
                  Payment Details
                </h2>

                {/* Show customer info */}
                <div className="mb-4 p-3 bg-gray-50 rounded-lg">
                  <p className="text-sm text-gray-600">
                    Subscribing as: <span className="font-medium text-gray-900">{customerName}</span>
                  </p>
                  <p className="text-sm text-gray-600">
                    Email: <span className="font-medium text-gray-900">{customerEmail}</span>
                  </p>
                  <p className="text-sm text-gray-600">
                    Billing: <span className="font-medium text-gray-900">
                      {billingType === 'charge_automatically' ? 'Auto-charge' : 'Pay each invoice'}
                    </span>
                  </p>
                </div>

                {/* Out-of-Band: Stripe Elements */}
                {billingType === 'out_of_band' && clientSecret && subscriptionId && invoiceId && stripePromise && elementsOptions && (
                  <Elements
                    stripe={stripePromise}
                    options={elementsOptions as any}
                    key={`${subscriptionId}-${displayType}`}
                  >
                    <SubscriptionCheckoutForm
                      amount={productPrice}
                      subscriptionId={subscriptionId}
                      invoiceId={invoiceId}
                      productName={productName}
                      interval={productInterval as 'month' | 'year'}
                      billingType="out_of_band"
                      displayType={displayType}
                      embeddedContainer={embeddedContainerRef.current}
                      embeddedContainerKey={embeddedContainerKey}
                    />
                  </Elements>
                )}

                {/* Auto-Charge: Payment Element with auto-redirect to HitPay */}
                {billingType === 'charge_automatically' && clientSecret && subscriptionId && customerId && invoiceId && stripePromise && (
                  <Elements
                    stripe={stripePromise}
                    options={{
                      clientSecret,
                      appearance: { theme: 'stripe' as const },
                      // Only show auto-charge CPMs
                      customPaymentMethods: autoChargeCpms.map((pm) => ({
                        id: pm.id,
                        options: { type: 'static' as const },
                      })),
                      paymentMethodOrder: ['card', ...getAutoChargeCpmTypeIds()],
                    } as any}
                    key={`auto-charge-${subscriptionId}`}
                  >
                    <AutoChargePaymentElement
                      subscriptionId={subscriptionId}
                      customerId={customerId}
                      invoiceId={invoiceId}
                      customerEmail={customerEmail}
                      customerName={customerName}
                      amount={invoiceAmount}
                      currency={invoiceCurrency}
                    />
                  </Elements>
                )}
              </>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}

// =============================================================================
// LOADING FALLBACK
// =============================================================================

function LoadingFallback() {
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mx-auto"></div>
        <p className="mt-3 text-sm text-gray-600">Loading...</p>
      </div>
    </div>
  );
}

// =============================================================================
// PAGE COMPONENT
// =============================================================================

export default function SubscribePage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <SubscribeContent />
    </Suspense>
  );
}
