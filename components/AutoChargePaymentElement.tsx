/**
 * AutoChargePaymentElement - Payment Element for auto-charge subscription flow.
 *
 * This component:
 * 1. Displays Stripe Payment Element with payment methods
 * 2. Tracks user's payment method selection via onChange event
 * 3. Shows a confirmation button for user to proceed
 * 4. For HitPay CPMs: opens deep link in new tab, polls for charge confirmation
 * 5. For Stripe native methods: uses stripe.confirmPayment()
 *
 * @see /app/subscribe/page.tsx - Parent page that renders this component
 * @see /api/hitpay/recurring-billing/create - Creates HitPay recurring session
 * @see /api/subscription/charge-status - Polls for invoice charge status
 */
'use client';

import { PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { useState, useRef, useEffect, useCallback } from 'react';
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
  /** Customer phone number (required for ShopeePay) */
  customerPhone?: string;
  /** Country code of the phone number (e.g. "65") */
  customerPhoneCountryCode?: string;
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
  customerPhone,
  customerPhoneCountryCode,
  amount,
  currency,
}: AutoChargePaymentElementProps) {
  const stripe = useStripe();
  const elements = useElements();
  const router = useRouter();

  // Track selected payment method type
  const [selectedPaymentMethodType, setSelectedPaymentMethodType] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ref to prevent duplicate submissions
  const hasInitiatedRedirect = useRef(false);
  // Ref for polling interval
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  // Check if selected method is a HitPay CPM
  const isHitPayCpm = selectedPaymentMethodType
    ? isCustomPaymentMethod(selectedPaymentMethodType)
    : false;

  // Get display name for selected CPM
  const selectedCpmConfig = selectedPaymentMethodType && isHitPayCpm
    ? getPaymentMethodConfig(selectedPaymentMethodType)
    : null;

  /**
   * Polls the charge status endpoint until the invoice is paid.
   */
  const startPolling = useCallback(() => {
    if (pollingRef.current) return;

    console.log('[AutoCharge] Starting charge status polling for invoice:', invoiceId);

    pollingRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/subscription/charge-status?invoiceId=${invoiceId}`);
        const data = await res.json();

        console.log('[AutoCharge] Poll result:', data.status);

        if (data.status === 'paid') {
          console.log('[AutoCharge] Invoice paid! Redirecting to success...');
          if (pollingRef.current) clearInterval(pollingRef.current);
          pollingRef.current = null;

          router.push(`/subscribe/success?subscription_id=${subscriptionId}&method=auto_charge`);
        }
      } catch (err) {
        console.error('[AutoCharge] Poll error:', err);
      }
    }, 3000);
  }, [invoiceId, subscriptionId, router]);

  // Clean up polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, []);

  /**
   * Opens HitPay deep link in new tab and starts polling.
   */
  const initiateHitPayRedirect = async (cpmTypeId: string) => {
    const cpmConfig = getPaymentMethodConfig(cpmTypeId);
    const recurringMethod = getHitpayRecurringMethod(cpmTypeId) || cpmConfig?.hitpayMethod || 'card';

    console.log(`[AutoCharge] Initiating HitPay redirect for ${cpmConfig?.displayName} (${recurringMethod})`);

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
        customerPhone,
        customerPhoneCountryCode,
        paymentMethod: recurringMethod,
        cpmTypeId,
        originUrl: window.location.href,
      }),
    });

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error + (data.details ? `: ${data.details}` : ''));
    }

    const redirectUrl = data.directLinkUrl || data.redirectUrl;
    if (redirectUrl) {
      console.log('[AutoCharge] Redirecting to HitPay:', redirectUrl);
      window.location.href = redirectUrl;

      // Show waiting state and start polling
      setAwaitingConfirmation(true);
      startPolling();
    } else {
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
        // HitPay CPM: open in new tab + poll for confirmation
        await initiateHitPayRedirect(selectedPaymentMethodType);
      } else {
        // Stripe native method: use confirmPayment
        if (!stripe || !elements) {
          throw new Error('Stripe not initialized');
        }

        const { error: confirmError } = await stripe.confirmPayment({
          elements,
          confirmParams: {
            return_url: `${window.location.origin}/subscribe/setup?subscription_id=${subscriptionId}&customer_id=${customerId}&invoice_id=${invoiceId}&payment_type=stripe_card`,
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
      setAwaitingConfirmation(false);
      hasInitiatedRedirect.current = false;
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
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
    if (isProcessing && !awaitingConfirmation) {
      return isHitPayCpm
        ? `Opening ${selectedCpmConfig?.displayName || 'payment provider'}...`
        : 'Processing...';
    }
    if (isHitPayCpm && selectedCpmConfig) {
      return `Setup ${selectedCpmConfig.displayName} for Auto-Charge`;
    }
    return 'Setup Auto-Charge';
  };

  // =========================================================================
  // AWAITING CONFIRMATION STATE
  // =========================================================================
  if (awaitingConfirmation) {
    return (
      <div className="space-y-4">
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-6 text-center">
          <svg
            className="animate-spin h-10 w-10 text-purple-600 mx-auto mb-4"
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
          <h3 className="text-lg font-semibold text-purple-900 mb-2">
            Awaiting Payment Authorization
          </h3>
          <p className="text-purple-700 text-sm mb-4">
            Complete the authorization in the new tab.
            This page will update automatically once confirmed.
          </p>
          <div className="bg-white rounded-lg p-3 inline-block">
            <p className="text-gray-600 text-sm">
              {selectedCpmConfig?.displayName || 'Payment'} • {formatPrice(amount, currency)}
            </p>
          </div>
        </div>

        <p className="text-xs text-gray-500 text-center">
          Don&apos;t see the authorization page?{' '}
          <button
            type="button"
            onClick={() => {
              // Reset to allow retry
              setAwaitingConfirmation(false);
              setIsProcessing(false);
              hasInitiatedRedirect.current = false;
              if (pollingRef.current) {
                clearInterval(pollingRef.current);
                pollingRef.current = null;
              }
            }}
            className="text-purple-600 hover:text-purple-700 underline"
          >
            Try again
          </button>
        </p>
      </div>
    );
  }

  // =========================================================================
  // NORMAL STATE — Payment Element + Setup Button
  // =========================================================================
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

      {/* Payment Element */}
      <div className="relative">
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
                  ? `Opening ${selectedCpmConfig?.displayName || 'payment provider'}...`
                  : 'Processing payment...'}
              </p>
              <p className="text-gray-500 text-sm mt-1">
                Please wait while we set up your payment method.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Error message */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-600 text-sm">{error}</p>
        </div>
      )}

      {/* Setup button */}
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
    </div>
  );
}
