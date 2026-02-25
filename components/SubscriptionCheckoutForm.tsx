/**
 * SubscriptionCheckoutForm - Handles subscription payments via Stripe and HitPay CPM.
 *
 * This component supports:
 * 1. Standard Stripe payments (card, PayNow via Stripe)
 * 2. Custom Payment Methods (HitPay PayNow, ShopeePay) via QR code
 *
 * CPM Payment Flow:
 * 1. User selects CPM (PayNow/ShopeePay) in Payment Element
 * 2. Component creates HitPay payment request with QR code
 * 3. User scans QR and pays
 * 4. Component polls for completion
 * 5. On success, marks invoice as paid and redirects to success page
 *
 * @see /app/api/create-subscription/route.ts - Creates subscription
 * @see /app/api/subscription/pay-invoice/route.ts - Marks invoice as paid
 * @see /app/subscribe/success/page.tsx - Success page
 */
'use client';

import {
  PaymentElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { QRCodeSVG } from 'qrcode.react';
import {
  isCustomPaymentMethod,
  getPaymentMethodConfig,
  getAllCpmTypeIds,
  getHitpayMethod,
} from '@/config/payment-methods';

// =============================================================================
// CONFIGURATION
// =============================================================================

const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 60;

// =============================================================================
// TYPES
// =============================================================================

type BillingType = 'out_of_band' | 'charge_automatically';

interface SubscriptionCheckoutFormProps {
  /** Subscription amount in cents (e.g., 2990 = $29.90) */
  amount: number;
  /** Stripe Subscription ID */
  subscriptionId: string;
  /** Stripe Invoice ID for the first payment */
  invoiceId: string;
  /** Product name for display */
  productName: string;
  /** Billing interval (month/year) */
  interval: 'month' | 'year';
  /** Billing type - defaults to out_of_band for this component */
  billingType?: BillingType;
}

interface QRCodeData {
  qrCode: string;
  paymentRequestId: string;
  checkoutUrl: string;
}

// =============================================================================
// COMPONENT
// =============================================================================

export function SubscriptionCheckoutForm({
  amount,
  subscriptionId,
  invoiceId,
  productName,
  interval,
  billingType = 'out_of_band',
}: SubscriptionCheckoutFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const router = useRouter();

  // Form state
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Track selected payment method type for CPM detection
  const [selectedPaymentMethodType, setSelectedPaymentMethodType] = useState<string | null>(null);

  // QR code state for custom payment methods
  const [qrCodeData, setQRCodeData] = useState<QRCodeData | null>(null);
  const [isLoadingQR, setIsLoadingQR] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState<'idle' | 'pending' | 'completed' | 'failed'>('idle');
  const [pollAttempts, setPollAttempts] = useState(0);
  const [fallbackCheckoutUrl, setFallbackCheckoutUrl] = useState<string | null>(null);

  // Check if the selected payment method is a custom payment method
  const isCustomPaymentSelected =
    selectedPaymentMethodType !== null &&
    isCustomPaymentMethod(selectedPaymentMethodType);

  // Get the HitPay method for the selected CPM
  const selectedHitpayMethod = selectedPaymentMethodType
    ? getHitpayMethod(selectedPaymentMethodType)
    : null;

  // Get the display name for the selected CPM
  const selectedPaymentConfig = selectedPaymentMethodType
    ? getPaymentMethodConfig(selectedPaymentMethodType)
    : null;

  /**
   * Formats a price in cents to SGD currency string.
   */
  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('en-SG', {
      style: 'currency',
      currency: 'SGD',
    }).format(price / 100);
  };

  /**
   * Get interval label for display
   */
  const getIntervalLabel = () => {
    return interval === 'month' ? 'month' : 'year';
  };

  /**
   * Creates a HitPay payment request and gets the QR code.
   */
  const createHitPayQR = useCallback(async () => {
    if (qrCodeData || isLoadingQR || !selectedHitpayMethod) return;

    setIsLoadingQR(true);
    setErrorMessage(null);
    setPollAttempts(0);

    try {
      const response = await fetch('/api/hitpay/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount,
          currency: 'sgd',
          referenceNumber: `sub_${subscriptionId}_inv_${invoiceId}`,
          paymentMethod: selectedHitpayMethod,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || error.details || 'Failed to create payment request');
      }

      const data = await response.json();

      if (!data.qrCode) {
        if (data.checkoutUrl) {
          setFallbackCheckoutUrl(data.checkoutUrl);
        }
        throw new Error(
          `QR code not available for ${selectedPaymentConfig?.displayName || 'this payment method'}.`
        );
      }

      setQRCodeData({
        qrCode: data.qrCode,
        paymentRequestId: data.paymentRequestId,
        checkoutUrl: data.checkoutUrl,
      });
      setPaymentStatus('pending');
      console.log(
        `[Subscription HitPay] QR generated for ${selectedPaymentConfig?.displayName}:`,
        data.paymentRequestId
      );
    } catch (error) {
      console.error('Error generating QR:', error);
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Failed to generate QR code. Please try again.'
      );
    } finally {
      setIsLoadingQR(false);
    }
  }, [amount, subscriptionId, invoiceId, qrCodeData, isLoadingQR, selectedHitpayMethod, selectedPaymentConfig?.displayName]);

  /**
   * Effect: Generate QR code when a custom payment method is selected.
   */
  useEffect(() => {
    if (isCustomPaymentSelected && selectedHitpayMethod && !qrCodeData && !isLoadingQR && !errorMessage) {
      createHitPayQR();
    }
  }, [isCustomPaymentSelected, selectedHitpayMethod, qrCodeData, isLoadingQR, errorMessage, createHitPayQR]);

  /**
   * Effect: Poll for payment status while QR code is displayed.
   */
  useEffect(() => {
    if (!qrCodeData?.paymentRequestId || paymentStatus !== 'pending') {
      return;
    }

    if (pollAttempts >= MAX_POLL_ATTEMPTS) {
      setPaymentStatus('failed');
      setErrorMessage(
        'Payment verification timed out. If you completed the payment, ' +
          'please contact support with your reference: ' +
          `sub_${subscriptionId}_inv_${invoiceId}`
      );
      return;
    }

    const pollInterval = setInterval(async () => {
      setPollAttempts((prev) => prev + 1);

      try {
        // Check HitPay payment status
        const statusResponse = await fetch('/api/hitpay/status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            paymentRequestId: qrCodeData.paymentRequestId,
          }),
        });

        if (!statusResponse.ok) {
          console.warn('[Subscription HitPay] Status check error:', statusResponse.status);
          return;
        }

        const statusData = await statusResponse.json();
        console.log('[Subscription HitPay] Status:', statusData);

        if (statusData.status === 'completed') {
          setPaymentStatus('completed');
          clearInterval(pollInterval);

          // Mark the invoice as paid
          try {
            const payInvoiceResponse = await fetch('/api/subscription/pay-invoice', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                invoiceId,
                hitpayPaymentId: qrCodeData.paymentRequestId,
                customPaymentMethodTypeId: selectedPaymentMethodType,
              }),
            });

            if (!payInvoiceResponse.ok) {
              const payError = await payInvoiceResponse.json();
              console.error('[Subscription HitPay] Pay invoice error:', payError);
            } else {
              console.log('[Subscription HitPay] Invoice marked as paid');
            }
          } catch (payError) {
            console.error('[Subscription HitPay] Pay invoice error:', payError);
          }

          // Redirect to success page
          const params = new URLSearchParams({
            subscription_id: subscriptionId,
            method: selectedPaymentConfig?.displayName.toLowerCase() || 'custom',
            hitpay_id: qrCodeData.paymentRequestId,
          });
          router.push(`/subscribe/success?${params.toString()}`);
        } else if (statusData.status === 'failed' || statusData.status === 'expired') {
          setPaymentStatus('failed');
          clearInterval(pollInterval);
          setErrorMessage('Payment failed or expired. Please try again.');
          setQRCodeData(null);
        }
      } catch (error) {
        console.error('Error polling payment status:', error);
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(pollInterval);
  }, [
    qrCodeData,
    paymentStatus,
    subscriptionId,
    invoiceId,
    router,
    selectedPaymentConfig,
    pollAttempts,
  ]);

  /**
   * Handles payment method changes in the Payment Element.
   */
  const handlePaymentElementChange = (event: { value: { type: string } }) => {
    setErrorMessage(null);

    // Reset QR state when switching payment methods
    if (event.value.type !== selectedPaymentMethodType) {
      setQRCodeData(null);
      setPaymentStatus('idle');
      setPollAttempts(0);
      setFallbackCheckoutUrl(null);
    }

    setSelectedPaymentMethodType(event.value.type);
  };

  /**
   * Handles form submission for card/native payments.
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    // For CPM, QR code handles the payment
    if (isCustomPaymentSelected) {
      return;
    }

    setIsProcessing(true);
    setErrorMessage(null);

    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/subscribe/success?subscription_id=${subscriptionId}`,
      },
    });

    if (error) {
      if (error.type === 'card_error' || error.type === 'validation_error') {
        setErrorMessage(error.message || 'Payment failed. Please try again.');
      } else {
        setErrorMessage('An unexpected error occurred. Please try again.');
      }
      setIsProcessing(false);
    }
  };

  /**
   * Regenerates the QR code.
   */
  const regenerateQR = () => {
    setQRCodeData(null);
    setPaymentStatus('idle');
    setErrorMessage(null);
    setPollAttempts(0);
    setFallbackCheckoutUrl(null);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Subscription Summary */}
      <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-4">
        <div className="flex justify-between items-center">
          <div>
            <p className="font-medium text-gray-900">{productName}</p>
            <p className="text-sm text-gray-600">
              Billed {interval === 'month' ? 'monthly' : 'yearly'}
            </p>
          </div>
          <div className="text-right">
            <p className="text-lg font-bold text-indigo-600">
              {formatPrice(amount)}
              <span className="text-sm font-normal text-gray-500">
                /{getIntervalLabel()}
              </span>
            </p>
          </div>
        </div>
      </div>

      {/* Stripe Payment Element */}
      <PaymentElement
        options={
          {
            layout: 'tabs',
            paymentMethodOrder: [...getAllCpmTypeIds(), 'card'],
          } as any
        }
        onChange={handlePaymentElementChange}
      />

      {/* QR Code section for CPM */}
      {isCustomPaymentSelected && (
        <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
          {isLoadingQR ? (
            <div className="flex flex-col items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
              <p className="mt-3 text-sm text-gray-600">Generating QR code...</p>
            </div>
          ) : qrCodeData ? (
            <div className="flex flex-col items-center">
              <p className="text-lg font-bold text-indigo-600 mb-3">
                {formatPrice(amount)}
              </p>

              <div className="bg-white p-3 rounded-lg border border-gray-200 mb-3">
                <QRCodeSVG value={qrCodeData.qrCode} size={180} level="M" />
              </div>

              <p className="text-sm text-gray-600 text-center mb-2">
                {selectedPaymentConfig?.displayName === 'PayNow'
                  ? 'Scan with your banking app to pay'
                  : `Complete payment via ${selectedPaymentConfig?.displayName || 'the app'}`}
              </p>

              <div className="flex items-center gap-2 text-xs text-gray-500 mb-3">
                <div className="animate-pulse w-2 h-2 bg-green-500 rounded-full"></div>
                <span>Waiting for payment... ({pollAttempts}/{MAX_POLL_ATTEMPTS})</span>
              </div>

              {qrCodeData.qrCode && (
                <a
                  href={qrCodeData.qrCode}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-indigo-600 hover:text-indigo-700 underline mb-2"
                >
                  Complete Mock Payment (for testing)
                </a>
              )}

              <button
                type="button"
                onClick={regenerateQR}
                className="text-xs text-gray-500 hover:text-gray-700 underline"
              >
                Generate new QR code
              </button>
            </div>
          ) : errorMessage ? (
            <div className="text-center py-4">
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-3">
                <p className="text-red-600 text-sm">{errorMessage}</p>
              </div>

              {fallbackCheckoutUrl && (
                <a
                  href={fallbackCheckoutUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors text-sm mb-3"
                >
                  Complete Payment via {selectedPaymentConfig?.displayName || 'Checkout'}
                </a>
              )}

              <div>
                <button
                  type="button"
                  onClick={regenerateQR}
                  className="text-sm text-gray-500 hover:text-gray-700 underline"
                >
                  Try again
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* Error message for non-CPM payments */}
      {errorMessage && !isCustomPaymentSelected && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-600 text-sm">{errorMessage}</p>
        </div>
      )}

      {/* Subscribe button - only shown for card/native payments */}
      {!isCustomPaymentSelected && (
        <button
          type="submit"
          disabled={!stripe || isProcessing}
          className="w-full bg-indigo-600 text-white py-3 rounded-lg hover:bg-indigo-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
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
              Processing...
            </span>
          ) : (
            `Subscribe - ${formatPrice(amount)}/${getIntervalLabel()}`
          )}
        </button>
      )}

      {/* Terms note - only shown for card/native payments */}
      {!isCustomPaymentSelected && (
        <p className="text-xs text-gray-500 text-center">
          By subscribing, you agree to be charged {formatPrice(amount)} per {getIntervalLabel()}.
          You can cancel anytime.
        </p>
      )}
    </form>
  );
}
