/**
 * POST /api/hitpay/create
 *
 * Creates a HitPay payment request with QR code for various payment methods.
 *
 * This endpoint is called when the user selects a custom payment method
 * (e.g., PayNow, ShopeePay) in the Stripe Payment Element. It generates a
 * QR code that the user can scan to complete the payment.
 *
 * The referenceNumber should be the Stripe PaymentIntent ID to link the
 * HitPay payment back to Stripe for recording.
 *
 * @example Request
 * ```json
 * {
 *   "amount": 1999,                    // Amount in cents
 *   "currency": "sgd",                 // Optional, defaults to "sgd"
 *   "referenceNumber": "pi_xxx",       // Stripe PaymentIntent ID
 *   "paymentMethod": "paynow_online"   // HitPay payment method
 * }
 * ```
 *
 * @example Response
 * ```json
 * {
 *   "paymentRequestId": "abc123",
 *   "qrCode": "data:image/png;base64,...",
 *   "qrCodeExpiry": "2024-01-01T12:00:00Z",
 *   "status": "pending",
 *   "checkoutUrl": "https://hit-pay.com/checkout/..."
 * }
 * ```
 */
import { NextRequest, NextResponse } from 'next/server';
import { createHitPayPaymentRequest } from '@/lib/hitpay';

// Default payment method if none specified
const DEFAULT_PAYMENT_METHOD = 'paynow_online';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { amount, currency = 'sgd', referenceNumber, paymentMethod } = body;

    // Use the provided payment method or fall back to default
    const hitpayPaymentMethod = paymentMethod || DEFAULT_PAYMENT_METHOD;

    // Validation with helpful error messages
    if (amount === undefined || amount === null) {
      return NextResponse.json(
        {
          error: 'Amount is required',
          hint: 'Provide amount in cents (e.g., 1000 for $10.00)',
        },
        { status: 400 }
      );
    }

    if (typeof amount !== 'number' || amount <= 0) {
      return NextResponse.json(
        { error: 'Amount must be a positive number' },
        { status: 400 }
      );
    }

    // HitPay/PayNow has minimum payment amounts
    if (amount < 100) {
      return NextResponse.json(
        {
          error: 'Minimum payment amount is $1.00',
          hint: 'PayNow requires a minimum of 100 cents ($1.00)',
        },
        { status: 400 }
      );
    }

    // Currency validation - SGD is the primary supported currency
    const supportedCurrencies = ['sgd'];
    if (!supportedCurrencies.includes(currency.toLowerCase())) {
      return NextResponse.json(
        {
          error: `Currency "${currency}" is not supported`,
          hint: `This payment method only supports: ${supportedCurrencies.join(', ').toUpperCase()}`,
        },
        { status: 400 }
      );
    }

    // Convert cents to dollars for HitPay (HitPay expects decimal amount)
    const amountInDollars = (amount / 100).toFixed(2);

    // Create the HitPay payment request
    // The reference_number links this payment to the Stripe PaymentIntent
    console.log(`[HitPay] Creating payment request with method: ${hitpayPaymentMethod}`);

    const paymentRequest = await createHitPayPaymentRequest({
      amount: amountInDollars,
      currency: currency.toLowerCase(),
      payment_methods: [hitpayPaymentMethod],
      generate_qr: true,
      purpose: 'TechStore Purchase',
      reference_number: referenceNumber || `ORDER-${Date.now()}`,
    });

    console.log(`[HitPay] Created payment request: ${paymentRequest.id} (method: ${hitpayPaymentMethod})`);

    // FX fields may be top-level or nested in qr_code_data (e.g. for QRIS)
    const qrAmount =
      paymentRequest.qr_amount ?? paymentRequest.qr_code_data?.qr_amount;
    const qrCurrency =
      paymentRequest.qr_currency ?? paymentRequest.qr_code_data?.qr_currency;
    const fxRate =
      paymentRequest.fx_rate ?? paymentRequest.qr_code_data?.fx_rate;

    if (qrAmount != null || qrCurrency != null || fxRate != null) {
      console.log(`[HitPay] FX data: qr_amount=${qrAmount} qr_currency=${qrCurrency} fx_rate=${fxRate}`);
    } else if (process.env.NODE_ENV === 'development') {
      // Log response keys to debug missing FX (HitPay may use different structure)
      const keys = Object.keys(paymentRequest);
      const qrCodeDataKeys = paymentRequest.qr_code_data
        ? Object.keys(paymentRequest.qr_code_data)
        : [];
      console.log(`[HitPay] Response keys: ${keys.join(', ')}; qr_code_data keys: ${qrCodeDataKeys.join(', ')}`);
    }

    return NextResponse.json({
      paymentRequestId: paymentRequest.id,
      qrCode: paymentRequest.qr_code_data?.qr_code,
      qrCodeExpiry: paymentRequest.qr_code_data?.qr_code_expiry,
      status: paymentRequest.status,
      checkoutUrl: paymentRequest.url,
      amount: paymentRequest.amount,
      currency: paymentRequest.currency,
      ...((qrAmount != null || qrCurrency != null || fxRate != null) && {
        ...(qrAmount != null && { qrAmount }),
        ...(qrCurrency != null && { qrCurrency }),
        ...(fxRate != null && { fxRate }),
      }),
    });
  } catch (error) {
    console.error('Error creating HitPay payment request:', error);

    // Provide more context for HitPay-specific errors
    if (error instanceof Error) {
      if (error.message.includes('HITPAY_API_KEY')) {
        return NextResponse.json(
          {
            error: 'HitPay configuration error',
            hint: 'Check that HITPAY_API_KEY is set correctly in .env.local',
          },
          { status: 500 }
        );
      }

      if (error.message.includes('HitPay API error')) {
        return NextResponse.json(
          {
            error: 'HitPay API error',
            details: error.message,
          },
          { status: 500 }
        );
      }
    }

    return NextResponse.json(
      { error: 'Failed to create payment request' },
      { status: 500 }
    );
  }
}
