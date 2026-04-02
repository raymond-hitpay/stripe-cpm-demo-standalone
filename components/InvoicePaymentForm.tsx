/**
 * InvoicePaymentForm - CPM payment form for paying a specific invoice.
 *
 * Used by the customer portal to pay open invoices via Custom Payment Methods.
 * Reuses the same HitPay QR + polling pattern from SubscriptionCheckoutForm,
 * but calls onSuccess instead of redirecting.
 *
 * Flow:
 * 1. User selects CPM in Payment Element
 * 2. User clicks "Proceed to Payment"
 * 3. QR modal opens, HitPay payment request created
 * 4. User scans QR and pays
 * 5. Poll for completion
 * 6. On success: mark invoice paid, call onSuccess()
 */
'use client';

import {
  PaymentElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  isCustomPaymentMethod,
  getPaymentMethodConfig,
  getAllCpmTypeIds,
  getHitpayMethod,
} from '@/config/payment-methods';
import { QRPaymentModal } from '@/components/QRPaymentModal';

const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 60;

interface QRCodeData {
  qrCode: string;
  paymentRequestId: string;
  checkoutUrl: string;
  amount?: string;
  currency?: string;
  qrAmount?: string;
  qrCurrency?: string;
  fxRate?: string;
}

interface InvoicePaymentFormProps {
  invoiceId: string;
  amount: number;
  currency: string;
  onSuccess: (hitpayPaymentId: string) => void;
  onCancel: () => void;
}

export function InvoicePaymentForm({
  invoiceId,
  amount,
  currency,
  onSuccess,
  onCancel,
}: InvoicePaymentFormProps) {
  const stripe = useStripe();
  const elements = useElements();

  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedPaymentMethodType, setSelectedPaymentMethodType] = useState<string | null>(null);
  const [qrCodeData, setQRCodeData] = useState<QRCodeData | null>(null);
  const [isLoadingQR, setIsLoadingQR] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState<'idle' | 'pending' | 'completed' | 'failed'>('idle');
  const [pollAttempts, setPollAttempts] = useState(0);
  const pollAttemptsRef = useRef(0);
  const [fallbackCheckoutUrl, setFallbackCheckoutUrl] = useState<string | null>(null);

  const isCustomPaymentSelected =
    selectedPaymentMethodType !== null &&
    isCustomPaymentMethod(selectedPaymentMethodType);

  const selectedHitpayMethod = selectedPaymentMethodType
    ? getHitpayMethod(selectedPaymentMethodType)
    : null;

  const selectedPaymentConfig = selectedPaymentMethodType
    ? getPaymentMethodConfig(selectedPaymentMethodType)
    : null;

  const formatPrice = (price: number) =>
    new Intl.NumberFormat('en-SG', {
      style: 'currency',
      currency: (currency || 'sgd').toUpperCase(),
    }).format(price / 100);

  const createHitPayQR = useCallback(async () => {
    if (qrCodeData || isLoadingQR || !selectedHitpayMethod) return;

    setIsLoadingQR(true);
    setErrorMessage(null);

    try {
      const response = await fetch('/api/hitpay/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount,
          currency: (currency || 'sgd').toLowerCase(),
          referenceNumber: `portal_inv_${invoiceId}`,
          paymentMethod: selectedHitpayMethod,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || error.details || 'Failed to create payment request');
      }

      const data = await response.json();

      if (!data.qrCode) {
        if (data.checkoutUrl) setFallbackCheckoutUrl(data.checkoutUrl);
        throw new Error(
          `QR code not available for ${selectedPaymentConfig?.displayName || 'this payment method'}.`
        );
      }

      setQRCodeData({
        qrCode: data.qrCode,
        paymentRequestId: data.paymentRequestId,
        checkoutUrl: data.checkoutUrl,
        ...(data.amount != null && { amount: data.amount }),
        ...(data.currency != null && { currency: data.currency }),
        ...(data.qrAmount != null && { qrAmount: data.qrAmount }),
        ...(data.qrCurrency != null && { qrCurrency: data.qrCurrency }),
        ...(data.fxRate != null && { fxRate: data.fxRate }),
      });
      setPaymentStatus('pending');
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Failed to generate QR code.'
      );
    } finally {
      setIsLoadingQR(false);
    }
  }, [
    amount,
    currency,
    invoiceId,
    qrCodeData,
    isLoadingQR,
    selectedHitpayMethod,
    selectedPaymentConfig?.displayName,
  ]);

  // Generate QR when modal opens with a CPM selected
  useEffect(() => {
    if (
      isCustomPaymentSelected &&
      selectedHitpayMethod &&
      !qrCodeData &&
      !isLoadingQR &&
      !errorMessage &&
      isModalOpen
    ) {
      createHitPayQR();
    }
  }, [
    isCustomPaymentSelected,
    selectedHitpayMethod,
    qrCodeData,
    isLoadingQR,
    errorMessage,
    createHitPayQR,
    isModalOpen,
  ]);

  // Poll for payment status
  useEffect(() => {
    if (!qrCodeData?.paymentRequestId || paymentStatus !== 'pending') return;

    pollAttemptsRef.current = 0;
    setPollAttempts(0);

    const pollInterval = setInterval(async () => {
      pollAttemptsRef.current += 1;
      setPollAttempts(pollAttemptsRef.current);

      if (pollAttemptsRef.current >= MAX_POLL_ATTEMPTS) {
        clearInterval(pollInterval);
        setPaymentStatus('failed');
        setErrorMessage(
          `Payment verification timed out. Please contact support with reference: portal_inv_${invoiceId}`
        );
        return;
      }

      try {
        const statusResponse = await fetch('/api/hitpay/status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paymentRequestId: qrCodeData.paymentRequestId }),
        });

        if (!statusResponse.ok) return;

        const statusData = await statusResponse.json();
        const statusLower = (statusData.status ?? '').toLowerCase();

        if (statusLower === 'completed') {
          setPaymentStatus('completed');
          clearInterval(pollInterval);

          const hitpayPaymentId = statusData.paymentId || qrCodeData.paymentRequestId;

          // Mark invoice as paid
          try {
            await fetch('/api/subscription/pay-invoice', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                invoiceId,
                hitpayPaymentId,
                customPaymentMethodTypeId: selectedPaymentMethodType,
              }),
            });
          } catch (err) {
            console.error('[Portal] Pay invoice error:', err);
          }

          setIsModalOpen(false);
          onSuccess(hitpayPaymentId);
        } else if (statusLower === 'failed' || statusLower === 'expired') {
          setPaymentStatus('failed');
          clearInterval(pollInterval);
          setErrorMessage('Payment failed or expired. Please try again.');
          setQRCodeData(null);
        }
      } catch (error) {
        console.error('[Portal] Poll error:', error);
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(pollInterval);
  }, [
    qrCodeData?.paymentRequestId,
    paymentStatus,
    invoiceId,
    selectedPaymentMethodType,
    onSuccess,
  ]);

  const handlePaymentElementChange = (event: { value: { type: string } }) => {
    setErrorMessage(null);
    if (event.value.type !== selectedPaymentMethodType) {
      setQRCodeData(null);
      setPaymentStatus('idle');
      setPollAttempts(0);
      setFallbackCheckoutUrl(null);
      setIsModalOpen(false);
    }
    setSelectedPaymentMethodType(event.value.type);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements || isCustomPaymentSelected) return;

    setIsProcessing(true);
    setErrorMessage(null);

    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/portal/invoices?customerId=&paid_invoice=${invoiceId}`,
      },
    });

    if (error) {
      setErrorMessage(error.message || 'Payment failed. Please try again.');
      setIsProcessing(false);
    }
  };

  const regenerateQR = () => {
    setQRCodeData(null);
    setPaymentStatus('idle');
    setErrorMessage(null);
    setPollAttempts(0);
    setFallbackCheckoutUrl(null);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement
        options={{
          layout: {
            type: 'accordion',
            defaultCollapsed: false,
            radios: 'always',
            spacedAccordionItems: false,
          },
          paymentMethodOrder: ['card', ...getAllCpmTypeIds()],
        } as any}
        onChange={handlePaymentElementChange}
      />

      {/* Proceed button for CPM */}
      {isCustomPaymentSelected && (
        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          className="w-full bg-indigo-600 text-white py-3 rounded-lg hover:bg-indigo-700 transition-colors font-medium"
        >
          Proceed to Payment with {selectedPaymentConfig?.displayName || 'Custom Method'}
        </button>
      )}

      {/* QR modal */}
      <QRPaymentModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
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

      {/* Error for card payments */}
      {errorMessage && !isCustomPaymentSelected && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <p className="text-red-600 text-sm">{errorMessage}</p>
        </div>
      )}

      {/* Pay button for card */}
      {!isCustomPaymentSelected && (
        <button
          type="submit"
          disabled={!stripe || isProcessing}
          className="w-full bg-indigo-600 text-white py-3 rounded-lg hover:bg-indigo-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isProcessing ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Processing...
            </span>
          ) : (
            `Pay ${formatPrice(amount)}`
          )}
        </button>
      )}

      <button
        type="button"
        onClick={onCancel}
        className="w-full text-gray-500 py-2 text-sm hover:text-gray-800 transition-colors"
      >
        Cancel
      </button>
    </form>
  );
}
