import { NextRequest, NextResponse } from 'next/server';
import { createHitPayPaymentRequest } from '@/lib/hitpay';

export async function POST(request: NextRequest) {
  try {
    const { amount, currency = 'sgd', referenceNumber } = await request.json();

    if (!amount || amount <= 0) {
      return NextResponse.json(
        { error: 'Invalid amount' },
        { status: 400 }
      );
    }

    // Convert cents to dollars for HitPay (HitPay expects decimal amount)
    const amountInDollars = (amount / 100).toFixed(2);

    const paymentRequest = await createHitPayPaymentRequest({
      amount: amountInDollars,
      currency: currency.toLowerCase(),
      payment_methods: ['paynow_online'],
      generate_qr: true,
      purpose: 'TechStore Purchase',
      reference_number: referenceNumber || `ORDER-${Date.now()}`,
    });

    console.log(`[HitPay] Created payment request: ${paymentRequest.id}`);

    return NextResponse.json({
      paymentRequestId: paymentRequest.id,
      qrCode: paymentRequest.qr_code_data?.qr_code,
      qrCodeExpiry: paymentRequest.qr_code_data?.qr_code_expiry,
      status: paymentRequest.status,
      checkoutUrl: paymentRequest.url,
    });
  } catch (error) {
    console.error('Error creating HitPay payment request:', error);
    return NextResponse.json(
      { error: 'Failed to create payment request' },
      { status: 500 }
    );
  }
}
