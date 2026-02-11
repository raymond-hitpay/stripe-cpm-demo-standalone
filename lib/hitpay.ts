/**
 * HitPay API client for PayNow QR code payment integration.
 *
 * This module handles:
 * - Creating payment requests with QR codes
 * - Checking payment status
 * - Verifying webhook signatures
 *
 * HitPay Environment URLs:
 * - Sandbox: https://api.sandbox.hit-pay.com/v1
 * - Production: https://api.hit-pay.com/v1
 *
 * @see https://hit-pay.com/docs/api
 */
import crypto from 'crypto';

/**
 * HitPay API base URL based on environment configuration.
 * Set NEXT_PUBLIC_HITPAY_ENV=production for live payments.
 */
const HITPAY_API_BASE =
  process.env.NEXT_PUBLIC_HITPAY_ENV === 'production'
    ? 'https://api.hit-pay.com/v1'
    : 'https://api.sandbox.hit-pay.com/v1';

/**
 * Request payload for creating a HitPay payment request.
 */
export interface HitPayPaymentRequest {
  /** Payment amount as a string (e.g., "10.00") */
  amount: string;
  /** ISO 4217 currency code (e.g., "sgd") */
  currency: string;
  /** Payment methods to enable (e.g., ["paynow_online"]) */
  payment_methods: string[];
  /** Whether to generate a QR code for the payment */
  generate_qr: boolean;
  /** Customer name (optional) */
  name?: string;
  /** Customer email (optional) */
  email?: string;
  /** Customer phone (optional) */
  phone?: string;
  /** Purpose/description of the payment */
  purpose?: string;
  /** Your reference number for this payment (use PaymentIntent ID) */
  reference_number?: string;
  /** Webhook URL for payment status notifications */
  webhook?: string;
  /** URL to redirect after payment completion */
  redirect_url?: string;
  /** Expiry date for the payment request */
  expiry_date?: string;
}

/**
 * Response from HitPay payment request API.
 */
export interface HitPayPaymentResponse {
  /** Unique payment request ID */
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  /** Payment amount as a string */
  amount: string;
  /** ISO 4217 currency code */
  currency: string;
  /** Current payment status */
  status: 'pending' | 'completed' | 'failed' | 'expired';
  purpose: string | null;
  reference_number: string | null;
  payment_methods: string[];
  /** HitPay checkout URL for customers */
  url: string;
  redirect_url: string | null;
  webhook: string | null;
  send_sms: boolean;
  send_email: boolean;
  allow_repeated_payments: boolean;
  expiry_date: string | null;
  created_at: string;
  updated_at: string;
  /** QR code data (only present if generate_qr was true) */
  qr_code_data?: {
    /** Base64 encoded QR code image or raw QR data */
    qr_code: string;
    /** When the QR code expires */
    qr_code_expiry: string | null;
  };
}

/**
 * Creates a new HitPay payment request with optional QR code generation.
 *
 * This is typically called when a user selects PayNow as their payment method.
 * The returned QR code can be displayed for the customer to scan with their
 * banking app.
 *
 * @param data - Payment request parameters
 * @returns The created payment request with QR code data
 * @throws Error if the API request fails
 *
 * @example
 * ```ts
 * const paymentRequest = await createHitPayPaymentRequest({
 *   amount: "10.00",
 *   currency: "sgd",
 *   payment_methods: ["paynow_online"],
 *   generate_qr: true,
 *   purpose: "Order #123",
 *   reference_number: "pi_xxx", // Link to Stripe PaymentIntent
 * });
 *
 * // Display paymentRequest.qr_code_data.qr_code to the user
 * ```
 */
export async function createHitPayPaymentRequest(
  data: HitPayPaymentRequest
): Promise<HitPayPaymentResponse> {
  const apiKey = process.env.HITPAY_API_KEY;

  if (!apiKey) {
    throw new Error(
      'HITPAY_API_KEY is not set. Please configure it in your .env.local file.'
    );
  }

  const response = await fetch(`${HITPAY_API_BASE}/payment-requests`, {
    method: 'POST',
    headers: {
      'X-BUSINESS-API-KEY': apiKey,
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`HitPay API error (${response.status}): ${error}`);
  }

  return response.json();
}

/**
 * Retrieves the current status of a HitPay payment request.
 *
 * Use this to poll for payment completion after displaying a QR code.
 * Recommended polling interval: 3 seconds.
 *
 * @param paymentRequestId - The HitPay payment request ID
 * @returns The current payment request status
 * @throws Error if the API request fails
 *
 * @example
 * ```ts
 * const status = await getHitPayPaymentStatus("abc123");
 * if (status.status === "completed") {
 *   // Payment successful - record in Stripe
 * }
 * ```
 */
export async function getHitPayPaymentStatus(
  paymentRequestId: string
): Promise<HitPayPaymentResponse> {
  const apiKey = process.env.HITPAY_API_KEY;

  if (!apiKey) {
    throw new Error(
      'HITPAY_API_KEY is not set. Please configure it in your .env.local file.'
    );
  }

  const response = await fetch(
    `${HITPAY_API_BASE}/payment-requests/${paymentRequestId}`,
    {
      method: 'GET',
      headers: {
        'X-BUSINESS-API-KEY': apiKey,
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`HitPay API error (${response.status}): ${error}`);
  }

  return response.json();
}

/**
 * Verifies the HMAC-SHA256 signature of a HitPay webhook payload.
 *
 * HitPay signs webhooks by:
 * 1. Sorting payload keys alphabetically (excluding 'hmac')
 * 2. Concatenating key-value pairs into a string: key1value1key2value2...
 * 3. Computing HMAC-SHA256 using your HITPAY_SALT
 *
 * IMPORTANT: Always verify webhook signatures before processing payments
 * to prevent fraudulent requests.
 *
 * @param payload - The webhook payload (form data or JSON body)
 * @param signature - The 'hmac' field from the payload
 * @returns true if the signature is valid, false otherwise
 *
 * @example
 * ```ts
 * // In your webhook handler
 * const isValid = verifyHitPayWebhook(req.body, req.body.hmac);
 * if (!isValid) {
 *   return res.status(401).json({ error: 'Invalid signature' });
 * }
 * // Process the payment...
 * ```
 */
export function verifyHitPayWebhook(
  payload: Record<string, string>,
  signature: string
): boolean {
  const salt = process.env.HITPAY_SALT;

  if (!salt) {
    console.error(
      '[HitPay] HITPAY_SALT not configured - cannot verify webhooks'
    );
    return false;
  }

  // Sort keys alphabetically and exclude 'hmac' from signature computation
  const sortedKeys = Object.keys(payload)
    .filter((key) => key !== 'hmac')
    .sort();

  // Build the string to sign: key1value1key2value2...
  const signatureString = sortedKeys
    .map((key) => `${key}${payload[key] ?? ''}`)
    .join('');

  // Compute HMAC-SHA256 using the salt
  const computedHmac = crypto
    .createHmac('sha256', salt)
    .update(signatureString)
    .digest('hex');

  return computedHmac === signature;
}
