/**
 * EmbeddedQRContent - QR code content rendered inside Payment Element's embedded container.
 *
 * This component is rendered via React Portal into the container provided by
 * Stripe's embedded customPaymentMethods handleRender callback.
 *
 * It replicates the same QR code display as the static flow but inside the Payment Element.
 */
'use client';

import { QRCodeSVG } from 'qrcode.react';
import { CustomPaymentMethodConfig } from '@/config/payment-methods';

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

interface EmbeddedQRContentProps {
  /** Payment amount in cents */
  amount: number;
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
  /** Selected payment method config */
  paymentMethodConfig: CustomPaymentMethodConfig | null;
  /** Callback to regenerate QR code */
  onRegenerateQR: () => void;
}

export function EmbeddedQRContent({
  amount,
  qrCodeData,
  isLoadingQR,
  paymentStatus,
  pollAttempts,
  maxPollAttempts,
  errorMessage,
  fallbackCheckoutUrl,
  paymentMethodConfig,
  onRegenerateQR,
}: EmbeddedQRContentProps) {
  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('en-SG', {
      style: 'currency',
      currency: 'SGD',
    }).format(price / 100);
  };

  /** Format amount string with currency code */
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
  /** Show amount/FX block when we have at least original amount from API */
  const hasFxInfo = hasOriginalAmount;

  // Loading state
  if (isLoadingQR) {
    return (
      <div className="flex flex-col items-center justify-center py-6">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
        <p className="mt-3 text-sm text-gray-600">Generating QR code...</p>
      </div>
    );
  }

  // QR code display
  if (qrCodeData) {
    return (
      <div className="flex flex-col items-center py-4">
        {hasFxInfo ? (
          <div className="w-full space-y-1 text-left mb-3 p-3 bg-gray-50 rounded-lg">
            <p className="text-xs text-gray-600">Original amount (payment request currency)</p>
            <p className="text-base font-bold text-indigo-600">
              {formatAmountWithCurrency(qrCodeData.amount!, qrCodeData.currency!)}
            </p>
            {hasConvertedAmount && (
              <>
                <p className="text-xs text-gray-600 mt-2">Converted amount (QR currency)</p>
                <p className="text-base font-bold text-indigo-600">
                  {formatAmountWithCurrency(qrCodeData.qrAmount!, qrCodeData.qrCurrency!)}
                </p>
              </>
            )}
            {hasFxRate && (
              <p className="text-xs text-gray-500 mt-2">
                FX rate: 1 {qrCodeData.currency!.toUpperCase()} :{' '}
                {Number(qrCodeData.fxRate!).toLocaleString('en-SG', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 6,
                })}{' '}
                {(qrCodeData.qrCurrency ?? qrCodeData.currency)!.toUpperCase()}
              </p>
            )}
          </div>
        ) : (
          <p className="text-lg font-bold text-indigo-600 mb-3">
            {formatPrice(amount)}
          </p>
        )}

        <div className="bg-white p-3 rounded-lg border border-gray-200 mb-3">
          <QRCodeSVG value={qrCodeData.qrCode} size={180} level="M" />
        </div>

        <p className="text-sm text-gray-600 text-center mb-2">
          {paymentMethodConfig?.displayName === 'PayNow'
            ? 'Scan with your banking app to pay'
            : `Complete payment via ${paymentMethodConfig?.displayName || 'the app'}`}
        </p>

        <div className="flex items-center gap-2 text-xs text-gray-500 mb-3">
          <div className="animate-pulse w-2 h-2 bg-green-500 rounded-full"></div>
          <span>
            Waiting for payment... ({pollAttempts}/{maxPollAttempts})
          </span>
        </div>

        {/* Link to HitPay checkout for testing */}
        {process.env.NEXT_PUBLIC_HITPAY_ENV !== 'production' && qrCodeData.qrCode && (
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
          onClick={onRegenerateQR}
          className="text-xs text-gray-500 hover:text-gray-700 underline"
        >
          Generate new QR code
        </button>
      </div>
    );
  }

  // Error state
  if (errorMessage) {
    return (
      <div className="text-center py-4">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-3">
          <p className="text-red-600 text-sm">{errorMessage}</p>
        </div>

        {/* Show checkout link as fallback if available */}
        {fallbackCheckoutUrl && (
          <a
            href={fallbackCheckoutUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors text-sm mb-3"
          >
            Complete Payment via {paymentMethodConfig?.displayName || 'Checkout'}
          </a>
        )}

        <div>
          <button
            type="button"
            onClick={onRegenerateQR}
            className="text-sm text-gray-500 hover:text-gray-700 underline"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  // Idle state - waiting for QR to be generated
  return (
    <div className="flex flex-col items-center justify-center py-6">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      <p className="mt-3 text-sm text-gray-600">Initializing payment...</p>
    </div>
  );
}
