/**
 * CheckoutForm - Handles both Stripe native payments and HitPay PayNow.
 *
 * This component integrates with Stripe's Payment Element and adds custom
 * payment method support for HitPay PayNow. When PayNow is selected, it:
 * 1. Creates a HitPay payment request with QR code
 * 2. Displays the QR code for the customer to scan
 * 3. Polls for payment completion
 * 4. Redirects to success page when payment is confirmed
 *
 * Payment Flow for Custom Payment Methods (PayNow):
 * 1. User selects PayNow in the Payment Element
 * 2. Component detects CPM selection via onChange event
 * 3. Calls /api/hitpay/create to generate QR code
 * 4. Displays QR code for user to scan with banking app
 * 5. Polls /api/payment/check-status every POLL_INTERVAL_MS
 * 6. On completion, redirects to success page
 *
 * Note: Polling provides immediate user feedback. Webhooks (configured separately)
 * serve as a backup to ensure payment recording even if the browser closes.
 *
 * @see /app/api/hitpay/create/route.ts - Creates HitPay payment request
 * @see /app/api/payment/check-status/route.ts - Polls payment status
 * @see /app/api/hitpay/webhook/route.ts - Webhook backup for reliability
 */
'use client';

import {
  PaymentElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';
import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import {
  isCustomPaymentMethod,
  getHitpayMethod,
  getPaymentMethodConfig,
  getAllCpmTypeIds,
} from '@/config/payment-methods';
import type { CpmDisplayType } from '@/components/CpmDisplayToggle';
import { EmbeddedQRContent } from '@/components/EmbeddedQRContent';
import { QRPaymentModal } from '@/components/QRPaymentModal';

// =============================================================================
// CONFIGURATION
// =============================================================================

/**
 * How often to poll for payment status (in milliseconds).
 * 3 seconds provides a good balance between responsiveness and server load.
 */
const POLL_INTERVAL_MS = 3000;

/**
 * Maximum number of polling attempts before showing a timeout message.
 * With 3-second intervals, 60 attempts = ~3 minutes max wait time.
 */
const MAX_POLL_ATTEMPTS = 60;

// =============================================================================
// TYPES
// =============================================================================

interface CheckoutFormProps {
  /** Payment amount in cents (e.g., 1999 = $19.99) */
  amount: number;
  /** Stripe PaymentIntent ID for this checkout session */
  paymentIntentId: string;
  /** CPM display type: 'static' (QR below) or 'embedded' (QR inside element) */
  displayType?: CpmDisplayType;
  /** DOM container for embedded mode (from handleRender callback) */
  embeddedContainer?: HTMLElement | null;
  /** Key to force re-render when embedded container changes */
  embeddedContainerKey?: number;
}

interface QRCodeData {
  /** QR code data (URL or PayNow string) */
  qrCode: string;
  /** HitPay payment request ID for status checking */
  paymentRequestId: string;
  /** HitPay checkout URL for fallback */
  checkoutUrl: string;
}

// =============================================================================
// COMPONENT
// =============================================================================

export function CheckoutForm({
  amount,
  paymentIntentId,
  displayType = 'static',
  embeddedContainer,
  embeddedContainerKey,
}: CheckoutFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const router = useRouter();

  // Track if we're in embedded mode with an active container
  const isEmbeddedMode = displayType === 'embedded' && embeddedContainer !== null;

  // Form state
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Modal state for static mode
  const [isModalOpen, setIsModalOpen] = useState(false);

  // QR code state for custom payment methods
  const [qrCodeData, setQRCodeData] = useState<QRCodeData | null>(null);
  const [isLoadingQR, setIsLoadingQR] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState<
    'idle' | 'pending' | 'completed' | 'failed'
  >('idle');
  const [pollAttempts, setPollAttempts] = useState(0);
  // Fallback checkout URL when QR fails
  const [fallbackCheckoutUrl, setFallbackCheckoutUrl] = useState<string | null>(null);

  // Track selected payment method type
  const [selectedPaymentMethodType, setSelectedPaymentMethodType] = useState<
    string | null
  >(null);

  // Check if the selected payment method is a custom payment method (e.g., PayNow, ShopeePay)
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
   * Creates a HitPay payment request and gets the QR code.
   * Called automatically when a custom payment method is selected.
   */
  const createHitPayQR = useCallback(async () => {
    if (qrCodeData || isLoadingQR || !selectedHitpayMethod) return;

    setIsLoadingQR(true);
    setErrorMessage(null);
    setPollAttempts(0); // Reset poll attempts for new QR

    try {
      const response = await fetch('/api/hitpay/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount,
          currency: 'sgd',
          // Use PaymentIntent ID as reference to link HitPay payment back to Stripe
          referenceNumber: paymentIntentId,
          // Pass the HitPay payment method based on selected CPM
          paymentMethod: selectedHitpayMethod,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || error.details || 'Failed to create payment request');
      }

      const data = await response.json();

      // Check if QR code was actually generated
      if (!data.qrCode) {
        // Store checkout URL as fallback if available
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
        `[HitPay] QR generated for ${selectedPaymentConfig?.displayName}:`,
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
  }, [amount, paymentIntentId, qrCodeData, isLoadingQR, selectedHitpayMethod, selectedPaymentConfig?.displayName]);

  /**
   * Effect: Generate QR code when appropriate.
   * - For embedded mode: Auto-generate when CPM is selected
   * - For static mode: Generate when modal opens
   * Does not retry if there's already an error (user must click "Try again").
   */
  useEffect(() => {
    const shouldGenerateQR =
      isCustomPaymentSelected &&
      selectedHitpayMethod &&
      !qrCodeData &&
      !isLoadingQR &&
      !errorMessage;

    // For static mode, only generate when modal is open
    // For embedded mode, auto-generate when CPM is selected
    if (shouldGenerateQR) {
      if (displayType === 'embedded' || (displayType === 'static' && isModalOpen)) {
        createHitPayQR();
      }
    }
  }, [isCustomPaymentSelected, selectedHitpayMethod, qrCodeData, isLoadingQR, errorMessage, createHitPayQR, displayType, isModalOpen]);

  /**
   * Effect: Poll for payment status while QR code is displayed.
   *
   * Polls the check-status endpoint every POLL_INTERVAL_MS until:
   * - Payment is completed (redirect to success)
   * - Payment fails/expires (show error, allow retry)
   * - Max attempts reached (show timeout message)
   */
  useEffect(() => {
    if (!qrCodeData?.paymentRequestId || paymentStatus !== 'pending') {
      return;
    }

    // Check if we've exceeded max attempts
    if (pollAttempts >= MAX_POLL_ATTEMPTS) {
      setPaymentStatus('failed');
      setErrorMessage(
        'Payment verification timed out. If you completed the payment, ' +
          'please contact support with your reference number: ' +
          paymentIntentId
      );
      return;
    }

    const pollInterval = setInterval(async () => {
      setPollAttempts((prev) => prev + 1);

      try {
        const response = await fetch('/api/payment/check-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            paymentIntentId,
            hitpayPaymentRequestId: qrCodeData.paymentRequestId,
            customPaymentMethodTypeId: selectedPaymentMethodType,
          }),
        });

        // Don't fail on HTTP errors - keep polling
        // Network issues are transient, webhook will catch it if polling fails
        if (!response.ok) {
          console.warn('[Payment Status] API error:', response.status);
          return;
        }

        const data = await response.json();
        console.log('[Payment Status]', data);

        if (data.status === 'completed') {
          setPaymentStatus('completed');
          clearInterval(pollInterval);

          // Use the actual HitPay payment ID from the response, fallback to payment request ID
          const hitpayPaymentId = data.hitpay?.paymentId || qrCodeData.paymentRequestId;

          // Redirect to success page with payment details
          const params = new URLSearchParams({
            method: selectedPaymentConfig?.displayName.toLowerCase() || 'custom',
            payment_id: paymentIntentId,
            hitpay_id: hitpayPaymentId,
            payment_record_id: data.stripe?.paymentRecordId || '',
          });
          router.push(`/shop/success?${params.toString()}`);
        } else if (data.status === 'failed' || data.status === 'expired') {
          setPaymentStatus('failed');
          clearInterval(pollInterval);
          setErrorMessage('Payment failed or expired. Please try again.');
          setQRCodeData(null);
        }
      } catch (error) {
        // Log but don't fail - keep polling on network errors
        console.error('Error polling payment status:', error);
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(pollInterval);
  }, [
    qrCodeData,
    paymentStatus,
    paymentIntentId,
    router,
    selectedPaymentMethodType,
    selectedPaymentConfig,
    pollAttempts,
  ]);

  /**
   * Handles payment method changes in the Payment Element.
   * Resets QR state when switching between payment methods.
   */
  const handlePaymentElementChange = (event: { value: { type: string } }) => {
    setErrorMessage(null);

    // Reset QR state when switching to a different payment method
    if (event.value.type !== selectedPaymentMethodType) {
      setQRCodeData(null);
      setPaymentStatus('idle');
      setPollAttempts(0);
      setFallbackCheckoutUrl(null);
      setIsModalOpen(false); // Close modal when switching payment methods
    }

    setSelectedPaymentMethodType(event.value.type);
  };

  /**
   * Opens the payment modal and triggers QR generation.
   */
  const handleProceedToPayment = () => {
    setIsModalOpen(true);
    // QR generation will be triggered by the useEffect
  };

  /**
   * Closes the payment modal.
   */
  const handleCloseModal = () => {
    setIsModalOpen(false);
    // Optionally reset QR state when closing modal
    // setQRCodeData(null);
    // setPaymentStatus('idle');
  };

  /**
   * Handles form submission for card payments.
   * For PayNow, the QR code flow handles payment - no submit needed.
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    // If PayNow is selected, QR code handles the payment - no submit needed
    if (isCustomPaymentSelected) {
      return;
    }

    setIsProcessing(true);
    setErrorMessage(null);

    // For Stripe native payment methods (card), use confirmPayment
    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/shop/success?method=card`,
      },
      redirect: 'if_required',
    });

    if (error) {
      setErrorMessage(error.message || 'An error occurred');
      setIsProcessing(false);
      return;
    }

    // Payment succeeded with card
    if (paymentIntent?.status === 'succeeded') {
      router.push('/shop/success?method=card');
    }
  };

  /**
   * Regenerates the QR code (e.g., after expiry or user request).
   */
  const regenerateQR = () => {
    setQRCodeData(null);
    setPaymentStatus('idle');
    setErrorMessage(null);
    setPollAttempts(0);
    setFallbackCheckoutUrl(null);
    // Will trigger useEffect to create new QR
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Stripe Payment Element - shows available payment methods */}
      <PaymentElement
        options={
          {
            layout: 'tabs',
            // Show custom payment methods first, then card
            paymentMethodOrder: [...getAllCpmTypeIds(), 'card'],
          } as any // Type assertion needed for beta API
        }
        onChange={handlePaymentElementChange}
      />

      {/* Proceed to Payment button for STATIC mode */}
      {isCustomPaymentSelected && displayType === 'static' && (
        <button
          type="button"
          onClick={handleProceedToPayment}
          className="w-full bg-indigo-600 text-white py-3 rounded-lg hover:bg-indigo-700 transition-colors font-medium"
        >
          Proceed to Payment
        </button>
      )}

      {/* QR Payment Modal for STATIC mode */}
      {displayType === 'static' && (
        <QRPaymentModal
          isOpen={isModalOpen}
          onClose={handleCloseModal}
          amount={amount}
          paymentMethodName={selectedPaymentConfig?.displayName || 'Payment'}
          qrCodeData={qrCodeData}
          isLoadingQR={isLoadingQR}
          paymentStatus={paymentStatus}
          pollAttempts={pollAttempts}
          maxPollAttempts={MAX_POLL_ATTEMPTS}
          errorMessage={errorMessage}
          fallbackCheckoutUrl={fallbackCheckoutUrl}
          onRegenerateQR={regenerateQR}
        />
      )}

      {/* QR Code for EMBEDDED mode - rendered via portal into Payment Element */}
      {isCustomPaymentSelected && displayType === 'embedded' && embeddedContainer &&
        createPortal(
          <EmbeddedQRContent
            key={embeddedContainerKey}
            amount={amount}
            qrCodeData={qrCodeData}
            isLoadingQR={isLoadingQR}
            paymentStatus={paymentStatus}
            pollAttempts={pollAttempts}
            maxPollAttempts={MAX_POLL_ATTEMPTS}
            errorMessage={errorMessage}
            fallbackCheckoutUrl={fallbackCheckoutUrl}
            paymentMethodConfig={selectedPaymentConfig}
            onRegenerateQR={regenerateQR}
          />,
          embeddedContainer
        )
      }

      {/* Error message for card payments */}
      {errorMessage && !isCustomPaymentSelected && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-600 text-sm">{errorMessage}</p>
        </div>
      )}

      {/* Pay button - only shown for card payments */}
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
            `Pay ${formatPrice(amount)}`
          )}
        </button>
      )}
    </form>
  );
}
