const HITPAY_API_BASE = process.env.NEXT_PUBLIC_HITPAY_ENV === 'production'
  ? 'https://api.hit-pay.com/v1'
  : 'https://api.sandbox.hit-pay.com/v1';

export interface HitPayPaymentRequest {
  amount: string;
  currency: string;
  payment_methods: string[];
  generate_qr: boolean;
  name?: string;
  email?: string;
  phone?: string;
  purpose?: string;
  reference_number?: string;
  webhook?: string;
  redirect_url?: string;
  expiry_date?: string;
}

export interface HitPayPaymentResponse {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  amount: string;
  currency: string;
  status: 'pending' | 'completed' | 'failed' | 'expired';
  purpose: string | null;
  reference_number: string | null;
  payment_methods: string[];
  url: string;
  redirect_url: string | null;
  webhook: string | null;
  send_sms: boolean;
  send_email: boolean;
  allow_repeated_payments: boolean;
  expiry_date: string | null;
  created_at: string;
  updated_at: string;
  qr_code_data?: {
    qr_code: string;
    qr_code_expiry: string | null;
  };
}

export async function createHitPayPaymentRequest(
  data: HitPayPaymentRequest
): Promise<HitPayPaymentResponse> {
  const response = await fetch(`${HITPAY_API_BASE}/payment-requests`, {
    method: 'POST',
    headers: {
      'X-BUSINESS-API-KEY': process.env.HITPAY_API_KEY!,
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`HitPay API error: ${error}`);
  }

  return response.json();
}

export async function getHitPayPaymentStatus(
  paymentRequestId: string
): Promise<HitPayPaymentResponse> {
  const response = await fetch(
    `${HITPAY_API_BASE}/payment-requests/${paymentRequestId}`,
    {
      method: 'GET',
      headers: {
        'X-BUSINESS-API-KEY': process.env.HITPAY_API_KEY!,
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`HitPay API error: ${error}`);
  }

  return response.json();
}

export function verifyHitPayWebhook(
  payload: Record<string, string>,
  signature: string
): boolean {
  const crypto = require('crypto');
  const salt = process.env.HITPAY_SALT!;

  // Sort keys and create string to sign (excluding hmac)
  const sortedKeys = Object.keys(payload)
    .filter((key) => key !== 'hmac')
    .sort();

  const signatureString = sortedKeys
    .map((key) => `${key}${payload[key] ?? ''}`)
    .join('');

  const computedHmac = crypto
    .createHmac('sha256', salt)
    .update(signatureString)
    .digest('hex');

  return computedHmac === signature;
}
