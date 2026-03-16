/**
 * QRPaymentModal - Modal overlay for QR code payment display.
 *
 * Shows QR code, polling status, and payment controls in a focused modal.
 * Used for static CPM display type to provide a cleaner checkout experience.
 */
'use client';

import { useEffect, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';

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

interface QRPaymentModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback to close the modal */
  onClose: () => void;
  /** Payment amount in cents */
  amount: number;
  /** Name of the payment method (e.g., "PayNow", "ShopeePay") */
  paymentMethodName: string;
  /** QR code data from HitPay */
  qrCodeData: QRCodeData | null;
  /** Whether QR is currently loading */
  isLoadingQR: boolean;
  /** Current payment status */
  paymentStatus: 'idle' | 'pending' | 'completed' | 'failed';
  /** Number of polling attempts */
  pollAttempts: number;
  /** Maximum polling attempts */
  maxPollAttempts: number;
  /** Error message if any */
  errorMessage: string | null;
  /** Fallback checkout URL when QR fails */
  fallbackCheckoutUrl: string | null;
  /** Callback to regenerate QR code */
  onRegenerateQR: () => void;
}

export function QRPaymentModal({
  isOpen,
  onClose,
  amount,
  paymentMethodName,
  qrCodeData,
  isLoadingQR,
  paymentStatus,
  pollAttempts,
  maxPollAttempts,
  errorMessage,
  fallbackCheckoutUrl,
  onRegenerateQR,
}: QRPaymentModalProps) {
  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('en-SG', {
      style: 'currency',
      currency: 'SGD',
    }).format(price / 100);
  };

  /** Format amount string with currency code (e.g. "35.64" + "sgd" → "SGD 35.64") */
  const formatAmountWithCurrency = (amountStr: string, currencyCode: string) => {
    const num = parseFloat(amountStr);
    if (Number.isNaN(num)) return `${amountStr} ${currencyCode.toUpperCase()}`;
    return new Intl.NumberFormat('en-SG', {
      style: 'currency',
      currency: currencyCode.toUpperCase(),
    }).format(num);
  };

  const hasOriginalAmount =
    qrCodeData?.amount != null && qrCodeData?.currency != null;
  const hasConvertedAmount =
    qrCodeData?.qrAmount != null && qrCodeData?.qrCurrency != null;
  const hasFxRate = qrCodeData?.fxRate != null;
  /** Show FX/original-amount block when we have at least original amount from API */
  const hasFxInfo = hasOriginalAmount;

  // Handle ESC key to close modal
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    },
    [isOpen, onClose]
  );

  // Add/remove event listeners and prevent body scroll
  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal Content */}
      <div className="relative bg-white rounded-2xl shadow-2xl max-w-md w-full mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">
            Pay with {paymentMethodName}
          </h2>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="p-6">
          {/* Amount */}
          <div className="text-center mb-6">
            {hasFxInfo ? (
              <div className="space-y-2 text-left">
                <p className="text-sm text-gray-600">
                  Original amount (payment request currency)
                </p>
                <p className="text-xl font-bold text-indigo-600">
                  {formatAmountWithCurrency(qrCodeData!.amount!, qrCodeData!.currency!)}
                </p>
                {hasConvertedAmount && (
                  <>
                    <p className="text-sm text-gray-600 mt-3">
                      Converted amount (QR currency)
                    </p>
                    <p className="text-xl font-bold text-indigo-600">
                      {formatAmountWithCurrency(qrCodeData!.qrAmount!, qrCodeData!.qrCurrency!)}
                    </p>
                  </>
                )}
                {hasFxRate && (
                  <p className="text-sm text-gray-500 mt-3">
                    FX rate: 1 {qrCodeData!.currency!.toUpperCase()} :{' '}
                    {Number(qrCodeData!.fxRate!).toLocaleString('en-SG', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 6,
                    })}{' '}
                    {(qrCodeData!.qrCurrency ?? qrCodeData!.currency)!.toUpperCase()}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-3xl font-bold text-indigo-600">
                {formatPrice(amount)}
              </p>
            )}
          </div>

          {/* Loading State */}
          {isLoadingQR && (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
              <p className="mt-4 text-gray-600">Generating QR code...</p>
            </div>
          )}

          {/* QR Code Display */}
          {!isLoadingQR && qrCodeData && !errorMessage && (
            <div className="flex flex-col items-center">
              {/* QR Code */}
              <div className="bg-white p-4 rounded-xl border-2 border-gray-100 shadow-sm mb-4">
                <QRCodeSVG value={qrCodeData.qrCode} size={200} level="M" />
              </div>

              {/* Instructions */}
              <p className="text-gray-600 text-center mb-4">
                {paymentMethodName === 'PayNow'
                  ? 'Scan with your banking app to pay'
                  : `Open ${paymentMethodName} app and scan to pay`}
              </p>

              {/* Polling Status */}
              <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
                <div className="animate-pulse w-2 h-2 bg-green-500 rounded-full"></div>
                <span>Waiting for payment... ({pollAttempts}/{maxPollAttempts})</span>
              </div>

              {/* Testing Link */}
              {process.env.NEXT_PUBLIC_HITPAY_ENV !== 'production' && qrCodeData.qrCode && (
                <a
                  href={qrCodeData.qrCode}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-indigo-600 hover:text-indigo-700 underline mb-2"
                >
                  Complete Mock Payment (for testing)
                </a>
              )}

              {/* Regenerate Button */}
              <button
                type="button"
                onClick={onRegenerateQR}
                className="text-sm text-gray-500 hover:text-gray-700 underline"
              >
                Generate new QR code
              </button>
            </div>
          )}

          {/* Error State */}
          {!isLoadingQR && errorMessage && (
            <div className="text-center py-4">
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
                <p className="text-red-600">{errorMessage}</p>
              </div>

              {/* Fallback Checkout Link */}
              {fallbackCheckoutUrl && (
                <a
                  href={fallbackCheckoutUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block bg-indigo-600 text-white px-6 py-3 rounded-lg hover:bg-indigo-700 transition-colors font-medium mb-4"
                >
                  Complete Payment via {paymentMethodName}
                </a>
              )}

              <div>
                <button
                  type="button"
                  onClick={onRegenerateQR}
                  className="text-gray-500 hover:text-gray-700 underline"
                >
                  Try again
                </button>
              </div>
            </div>
          )}

          {/* Idle State (before QR generation) */}
          {!isLoadingQR && !qrCodeData && !errorMessage && (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
              <p className="mt-4 text-gray-600">Initializing payment...</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-100 bg-gray-50">
          <button
            onClick={onClose}
            className="w-full py-3 px-4 border border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-100 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
