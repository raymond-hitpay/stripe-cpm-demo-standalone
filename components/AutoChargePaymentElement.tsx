/**
 * AutoChargePaymentElement - Payment Element for auto-charge subscription flow.
 *
 * This component:
 * 1. Displays Stripe Payment Element with payment methods
 * 2. Tracks user's payment method selection via onChange event
 * 3. Shows a confirmation button for user to proceed
 * 4. For HitPay CPMs: redirects to HitPay for authorization
 * 5. For Stripe native methods: uses stripe.confirmPayment()
 *
 * @see /app/subscribe/page.tsx - Parent page that renders this component
 * @see /api/hitpay/recurring-billing/create - Creates HitPay recurring session
 */
'use client';

import { PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  isCustomPaymentMethod,
  getPaymentMethodConfig,
  getAutoChargeCpmTypeIds,
  getHitpayRecurringMethod,
} from '@/config/payment-methods';

// =============================================================================
// TYPES
// =============================================================================

interface AutoChargePaymentElementProps {
  /** Stripe Subscription ID */
  subscriptionId: string;
  /** Stripe Customer ID */
  customerId: string;
  /** Stripe Invoice ID for the first payment */
  invoiceId: string;
  /** Customer email */
  customerEmail: string;
  /** Customer name */
  customerName: string;
  /** Invoice amount in dollars (e.g., 29.90) */
  amount: number;
  /** Currency code (e.g., 'sgd') */
  currency: string;
}

// =============================================================================
// COMPONENT
// =============================================================================

export function AutoChargePaymentElement({
  subscriptionId,
  customerId,
  invoiceId,
  customerEmail,
  customerName,
  amount,
  currency,
}: AutoChargePaymentElementProps) {
  const stripe = useStripe();
  const elements = useElements();

  // Track selected payment method type
  const [selectedPaymentMethodType, setSelectedPaymentMethodType] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newTabOpened, setNewTabOpened] = useState(false);
  const [pollingTimedOut, setPollingTimedOut] = useState(false);

  // Ref to prevent duplicate submissions
  const hasInitiatedRedirect = useRef(false);

  const router = useRouter();
  const pollingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollingStarted = useRef(false);

  useEffect(() => {
    return () => {
      if (pollingRef.current) clearTimeout(pollingRef.current);
    };
  }, []);

  // Check if selected method is a HitPay CPM
  const isHitPayCpm = selectedPaymentMethodType
    ? isCustomPaymentMethod(selectedPaymentMethodType)
    : false;

  // Get display name for selected CPM
  const selectedCpmConfig = selectedPaymentMethodType && isHitPayCpm
    ? getPaymentMethodConfig(selectedPaymentMethodType)
    : null;

  /**
   * Polls /api/subscription/invoice-status until paid, then redirects to success.
   */
  const startPollingForPayment = (invoiceIdToCheck: string) => {
    if (pollingStarted.current) return;
    pollingStarted.current = true;

    let attempts = 0;
    const MAX_ATTEMPTS = 60; // 60 × 2s = 120s

    const poll = async () => {
      try {
        const res = await fetch(`/api/subscription/invoice-status?invoiceId=${invoiceIdToCheck}`);
        const data = await res.json();

        if (data.paid && data.hitpayPaymentId) {
          console.log('[AutoCharge] Invoice paid — redirecting original tab to success');
          const params = new URLSearchParams({
            subscription_id: subscriptionId,
            method: 'auto_charge',
            hitpay_id: data.hitpayPaymentId,
          });
          router.push(`/subscribe/success?${params.toString()}`);
          return;
        }

        attempts++;
        if (attempts < MAX_ATTEMPTS) {
          pollingRef.current = setTimeout(poll, 2000);
        } else {
          setPollingTimedOut(true);
        }
      } catch {
        attempts++;
        if (attempts < MAX_ATTEMPTS) {
          pollingRef.current = setTimeout(poll, 2000);
        } else {
          setPollingTimedOut(true);
        }
      }
    };

    poll();
  };

  /**
   * Initiates redirect to HitPay for payment method authorization.
   */
  const initiateHitPayRedirect = async (cpmTypeId: string) => {
    const cpmConfig = getPaymentMethodConfig(cpmTypeId);
    const recurringMethod = getHitpayRecurringMethod(cpmTypeId) || cpmConfig?.hitpayMethod || 'card';

    console.log(`[AutoCharge] Initiating HitPay redirect for ${cpmConfig?.displayName} (${recurringMethod})`);

    // Open blank tab synchronously (before await) to avoid popup blocker
    const newTab = window.open('', '_blank');

    const response = await fetch('/api/hitpay/recurring-billing/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerId,
        subscriptionId,
        invoiceId,
        amount,
        currency,
        customerEmail,
        customerName,
        paymentMethod: recurringMethod,
        cpmTypeId,
        originUrl: window.location.href,
      }),
    });

    const data = await response.json();

    if (data.error) {
      newTab?.close();
      throw new Error(data.error + (data.details ? `: ${data.details}` : ''));
    }

    if (data.directLinkUrl && newTab) {
      // App-based method (Shopee, GrabPay, TNG) — redirect directly to the app
      console.log('[AutoCharge] Using direct link:', data.directLinkUrl);
      newTab.location.href = data.directLinkUrl;
      setIsProcessing(false);
      setNewTabOpened(true);
      hasInitiatedRedirect.current = false;
      startPollingForPayment(invoiceId);
    } else if (data.redirectUrl && newTab) {
      // Fallback — HitPay hosted checkout page (existing behavior)
      console.log('[AutoCharge] Opening HitPay hosted page:', data.redirectUrl);
      newTab.location.href = data.redirectUrl;
      setIsProcessing(false);
      setNewTabOpened(true);
      hasInitiatedRedirect.current = false;
      startPollingForPayment(invoiceId);
    } else {
      newTab?.close();
      throw new Error('No redirect URL received from HitPay');
    }
  };

  /**
   * Handles the setup button click.
   */
  const handleSetupClick = async () => {
    if (!selectedPaymentMethodType || hasInitiatedRedirect.current) return;

    hasInitiatedRedirect.current = true;
    setIsProcessing(true);
    setError(null);

    try {
      if (isHitPayCpm) {
        // HitPay CPM: redirect to HitPay for authorization
        await initiateHitPayRedirect(selectedPaymentMethodType);
      } else {
        // Stripe native method: use confirmPayment
        if (!stripe || !elements) {
          throw new Error('Stripe not initialized');
        }

        const { error: confirmError } = await stripe.confirmPayment({
          elements,
          confirmParams: {
            return_url: `${window.location.origin}/subscribe/success?subscription_id=${subscriptionId}`,
          },
        });

        if (confirmError) {
          throw new Error(confirmError.message || 'Payment failed');
        }
      }
    } catch (err) {
      console.error('[AutoCharge] Error:', err);
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to setup payment. Please try again.'
      );
      setIsProcessing(false);
      hasInitiatedRedirect.current = false;
    }
  };

  /**
   * Handles payment method changes in the Payment Element.
   */
  const handlePaymentElementChange = (event: { value: { type: string } }) => {
    const paymentMethodType = event.value.type;
    console.log(`[AutoCharge] Payment method selected: ${paymentMethodType}`);
    setSelectedPaymentMethodType(paymentMethodType);
    setError(null);
    setNewTabOpened(false);
  };

  /**
   * Formats a price to currency string.
   */
  const formatPrice = (price: number, curr: string = 'SGD') => {
    return new Intl.NumberFormat('en-SG', {
      style: 'currency',
      currency: curr.toUpperCase(),
    }).format(price);
  };

  /**
   * Get button text based on selected payment method.
   */
  const getButtonText = () => {
    if (isProcessing) {
      return isHitPayCpm
        ? `Redirecting to ${selectedCpmConfig?.displayName || 'payment provider'}...`
        : 'Processing...';
    }
    if (isHitPayCpm && selectedCpmConfig) {
      return `Setup ${selectedCpmConfig.displayName} for Auto-Charge`;
    }
    return 'Setup Auto-Charge';
  };

  return (
    <div className="space-y-4">
      {/* Info box */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="font-medium text-blue-900 text-sm mb-2">
          Auto-Charge Setup
        </h3>
        <p className="text-blue-700 text-sm">
          Select a payment method below and click the button to authorize
          automatic payments for future billing cycles.
        </p>
      </div>

      {/* Amount summary */}
      <div className="bg-gray-50 rounded-lg p-4">
        <div className="flex justify-between items-center">
          <span className="text-gray-600 text-sm">First payment</span>
          <span className="font-medium text-gray-900">
            {formatPrice(amount, currency)}
          </span>
        </div>
      </div>

      {/* Payment Element — hidden once new tab opens */}
      <div className={`relative${newTabOpened ? ' hidden' : ''}`}>
        <PaymentElement
          options={{
            layout: 'tabs',
            paymentMethodOrder: getAutoChargeCpmTypeIds(),
          }}
          onChange={handlePaymentElementChange}
        />

        {/* Processing overlay */}
        {isProcessing && (
          <div className="absolute inset-0 bg-white/90 flex items-center justify-center rounded-lg">
            <div className="text-center">
              <svg
                className="animate-spin h-8 w-8 text-purple-600 mx-auto mb-3"
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
              <p className="text-gray-700 font-medium">
                {isHitPayCpm
                  ? `Redirecting to ${selectedCpmConfig?.displayName || 'payment provider'}...`
                  : 'Processing payment...'}
              </p>
              <p className="text-gray-500 text-sm mt-1">
                Please wait while we set up your payment method.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Error message — hidden once new tab opens */}
      {error && !newTabOpened && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-600 text-sm">{error}</p>
        </div>
      )}

      {/* Waiting state — replaces form after new tab opens */}
      {newTabOpened && (
        <div className="py-8 text-center space-y-4">
          {pollingTimedOut ? (
            <>
              <div className="w-12 h-12 bg-yellow-100 rounded-full flex items-center justify-center mx-auto">
                <svg className="w-6 h-6 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M12 2a10 10 0 100 20A10 10 0 0012 2z" />
                </svg>
              </div>
              <p className="text-gray-800 font-medium">
                Payment is taking longer than expected.
              </p>
              <p className="text-gray-500 text-sm">
                Please check back shortly or contact support if the issue persists.
              </p>
              <button
                type="button"
                onClick={() => {
                  setPollingTimedOut(false);
                  pollingStarted.current = false;
                  startPollingForPayment(invoiceId);
                }}
                className="mx-auto block bg-purple-600 text-white px-6 py-2 rounded-lg hover:bg-purple-700 transition-colors font-medium text-sm"
              >
                Check again
              </button>
            </>
          ) : (
            <>
              <svg
                className="animate-spin h-10 w-10 text-purple-600 mx-auto"
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
              <p className="text-gray-800 font-medium">
                Waiting for payment confirmation in new tab...
              </p>
              <p className="text-gray-500 text-sm">
                Complete the authorization in the new tab. This page will update automatically.
              </p>
            </>
          )}
        </div>
      )}

      {/* Setup button — hidden once new tab opened */}
      {!newTabOpened && (
        <>
          <button
            type="button"
            onClick={handleSetupClick}
            disabled={!selectedPaymentMethodType || isProcessing || !stripe}
            className="w-full bg-purple-600 text-white py-3 rounded-lg hover:bg-purple-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isProcessing ? (
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
                {getButtonText()}
              </span>
            ) : (
              getButtonText()
            )}
          </button>

          {/* Terms disclaimer */}
          <p className="text-xs text-gray-500 text-center">
            By continuing, you authorize automatic charges to your payment method
            for future billing cycles.
          </p>
        </>
      )}
    </div>
  );
}
