'use client';

import {
  PaymentElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';
import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { QRCodeSVG } from 'qrcode.react';
import { useRouter } from 'next/navigation';

interface CheckoutFormProps {
  amount: number;
  paymentIntentId: string;
  customPaymentMethodTypeId: string;
  embedContainer: HTMLElement | null;
}

interface QRCodeData {
  qrCode: string;
  paymentRequestId: string;
  checkoutUrl: string;
}

export function CheckoutForm({
  amount,
  paymentIntentId,
  customPaymentMethodTypeId,
  embedContainer,
}: CheckoutFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const router = useRouter();
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [qrCodeData, setQRCodeData] = useState<QRCodeData | null>(null);
  const [isLoadingQR, setIsLoadingQR] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState<
    'idle' | 'pending' | 'completed' | 'failed'
  >('idle');

  // PayNow is selected when embedContainer is available
  const isCustomPaymentSelected = !!embedContainer;

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('en-SG', {
      style: 'currency',
      currency: 'SGD',
    }).format(price / 100);
  };

  // Create HitPay QR code
  const createHitPayQR = useCallback(async () => {
    if (qrCodeData || isLoadingQR) return; // Already have QR or loading

    setIsLoadingQR(true);
    setErrorMessage(null);

    try {
      const response = await fetch('/api/hitpay/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount,
          currency: 'sgd',
          referenceNumber: paymentIntentId,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create payment request');
      }

      const data = await response.json();
      setQRCodeData({
        qrCode: data.qrCode,
        paymentRequestId: data.paymentRequestId,
        checkoutUrl: data.checkoutUrl,
      });
      setPaymentStatus('pending');
      console.log('[HitPay] QR generated:', data.paymentRequestId);
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
  }, [amount, paymentIntentId, qrCodeData, isLoadingQR]);

  // Generate QR code when PayNow is selected (embedContainer becomes available)
  useEffect(() => {
    if (embedContainer && !qrCodeData && !isLoadingQR) {
      createHitPayQR();
    }
  }, [embedContainer, qrCodeData, isLoadingQR, createHitPayQR]);

  // Poll for payment status
  useEffect(() => {
    if (!qrCodeData?.paymentRequestId || paymentStatus !== 'pending') {
      return;
    }

    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch('/api/payment/check-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            paymentIntentId,
            hitpayPaymentRequestId: qrCodeData.paymentRequestId,
            customPaymentMethodTypeId,
          }),
        });

        const data = await response.json();
        console.log('[Payment Status]', data);

        if (data.status === 'completed') {
          setPaymentStatus('completed');
          clearInterval(pollInterval);

          // Redirect to success page with payment details
          const params = new URLSearchParams({
            method: 'paynow',
            payment_id: paymentIntentId,
            hitpay_id: qrCodeData.paymentRequestId,
            payment_record_id: data.stripe?.paymentRecordId || '',
          });
          router.push(`/success?${params.toString()}`);
        } else if (data.status === 'failed' || data.status === 'expired') {
          setPaymentStatus('failed');
          clearInterval(pollInterval);
          setErrorMessage('Payment failed or expired. Please try again.');
          setQRCodeData(null);
        }
      } catch (error) {
        console.error('Error polling payment status:', error);
      }
    }, 3000);

    return () => clearInterval(pollInterval);
  }, [
    qrCodeData,
    paymentStatus,
    paymentIntentId,
    router,
    customPaymentMethodTypeId,
  ]);

  // Handle payment method change in Payment Element
  const handlePaymentElementChange = () => {
    setErrorMessage(null);
  };

  // Reset QR state when switching away from PayNow (embedContainer becomes null)
  useEffect(() => {
    if (!embedContainer) {
      setQRCodeData(null);
      setPaymentStatus('idle');
    }
  }, [embedContainer]);

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
        return_url: `${window.location.origin}/success?method=card`,
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
      router.push('/success?method=card');
    }
  };

  const regenerateQR = () => {
    setQRCodeData(null);
    setPaymentStatus('idle');
    setErrorMessage(null);
    // Will trigger useEffect to create new QR
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <PaymentElement
        options={
          {
            layout: 'tabs',
            paymentMethodOrder: [customPaymentMethodTypeId, 'card'],
          } as any
        }
        onChange={handlePaymentElementChange}
      />

      {/* QR Code rendered via portal into Stripe's embedded container */}
      {embedContainer &&
        createPortal(
          <div className="p-4 bg-gray-50">
            {isLoadingQR ? (
              <div className="flex flex-col items-center justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                <p className="mt-3 text-sm text-gray-600">
                  Generating QR code...
                </p>
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
                  Scan with your banking app to pay
                </p>

                <div className="flex items-center gap-2 text-xs text-gray-500 mb-3">
                  <div className="animate-pulse w-2 h-2 bg-green-500 rounded-full"></div>
                  <span>Waiting for payment...</span>
                </div>

                {qrCodeData.checkoutUrl && (
                  <a
                    href={qrCodeData.checkoutUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-indigo-600 hover:text-indigo-700 underline mb-2"
                  >
                    Pay via HitPay checkout (for testing)
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
                <p className="text-red-600 text-sm mb-2">{errorMessage}</p>
                <button
                  type="button"
                  onClick={regenerateQR}
                  className="text-sm text-indigo-600 hover:text-indigo-700 underline"
                >
                  Try again
                </button>
              </div>
            ) : null}
          </div>,
          embedContainer
        )}

      {errorMessage && !isCustomPaymentSelected && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-600 text-sm">{errorMessage}</p>
        </div>
      )}

      {/* Only show Pay button for card payments */}
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
