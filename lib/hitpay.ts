/**
 * HitPay API client for payment integration.
 *
 * This module handles:
 * - Creating payment requests with QR codes (one-time payments)
 * - Creating recurring billing sessions (save payment method)
 * - Charging saved payment methods (auto-charge subscriptions)
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
 * Set NEXT_PUBLIC_HITPAY_ENV=sandbox|staging|production
 */
const hitpayEnv = process.env.NEXT_PUBLIC_HITPAY_ENV || 'sandbox';
const HITPAY_API_BASE =
  hitpayEnv === 'production' ? 'https://api.hit-pay.com/v1'
  : hitpayEnv === 'staging'  ? 'https://api.staging.hit-pay.com/v1'
  : 'https://api.sandbox.hit-pay.com/v1';

const HITPAY_API_KEY =
  hitpayEnv === 'production' ? process.env.HITPAY_API_KEY_PRODUCTION
  : hitpayEnv === 'staging'  ? process.env.HITPAY_API_KEY_STAGING
  : process.env.HITPAY_API_KEY_SANDBOX;

const HITPAY_SALT =
  hitpayEnv === 'production' ? process.env.HITPAY_SALT_PRODUCTION
  : hitpayEnv === 'staging'  ? process.env.HITPAY_SALT_STAGING
  : process.env.HITPAY_SALT_SANDBOX;

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
  /** Whether to generate an embedded payment for the payment */
  generate_embed: boolean;
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
 * Individual payment object within a payment request.
 * Returned in the `payments` array when a payment request has been paid.
 */
export interface HitPayPayment {
  /** Unique payment/transaction ID (e.g., "a12b19e4-3b07-4ecc-a621-57a751203fca") */
  id?: string;
  /** Alternative field name for payment ID */
  payment_id?: string;
  /** Payment request ID this payment belongs to */
  payment_request_id?: string;
  /** Payment method used (e.g., "paynow_online", "shopee_pay") */
  payment_type?: string;
  /** Payment status */
  status?: 'succeeded' | 'pending' | 'failed' | 'refunded';
  /** Amount paid */
  amount?: string;
  /** Currency */
  currency?: string;
  /** Your reference number */
  reference_number?: string | null;
  /** Payment timestamp */
  created_at?: string;
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
  /** QR code data (only present if generate_embed was true) */
  qr_code_data?: {
    /** Base64 encoded QR code image or raw QR data */
    qr_code: string;
    /** When the QR code expires */
    qr_code_expiry: string | null;
    /** When charge currency differs: amount on QR (sometimes nested here) */
    qr_amount?: string;
    qr_currency?: string;
    fx_rate?: string;
  };
  /** When charge currency differs from request currency: amount shown on QR */
  qr_amount?: string;
  /** When charge currency differs: currency of the QR (e.g. "vnd", "sgd") */
  qr_currency?: string;
  /** When charge currency differs: exchange rate (1 request currency = fx_rate qr currency) */
  fx_rate?: string;
  /** Direct link for app-based payment methods (Shopee, GrabPay, TNG) */
  direct_link?: {
    direct_link_url: string;
  };
  /** Array of payments (present when payment request has been paid) */
  payments?: HitPayPayment[];
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
 *   generate_embed: true,
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
  const apiKey = HITPAY_API_KEY;

  if (!apiKey) {
    throw new Error(
      `HITPAY_API_KEY_${hitpayEnv.toUpperCase()} is not set. Please configure it in your .env.local file.`
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
  const apiKey = HITPAY_API_KEY;

  if (!apiKey) {
    throw new Error(
      `HITPAY_API_KEY_${hitpayEnv.toUpperCase()} is not set. Please configure it in your .env.local file.`
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
  const salt = HITPAY_SALT;

  if (!salt) {
    console.error(
      `[HitPay] HITPAY_SALT_${hitpayEnv.toUpperCase()} not configured - cannot verify webhooks`
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

/**
 * Verifies the HMAC-SHA256 signature of a HitPay JSON webhook payload.
 *
 * Same HMAC logic as verifyHitPayWebhook but handles nested objects by
 * JSON.stringify-ing them when building the signature string.
 *
 * @param payload - The parsed JSON webhook body
 * @param signature - The 'hmac' field from the payload
 * @returns true if the signature is valid, false otherwise
 */
export function verifyHitPayJsonWebhook(
  payload: Record<string, unknown>,
  signature: string
): boolean {
  const salt = HITPAY_SALT;

  if (!salt) {
    console.error(
      `[HitPay] HITPAY_SALT_${hitpayEnv.toUpperCase()} not configured - cannot verify webhooks`
    );
    return false;
  }

  const sortedKeys = Object.keys(payload)
    .filter((key) => key !== 'hmac')
    .sort();

  const signatureString = sortedKeys
    .map((key) => {
      const value = payload[key];
      if (value === null || value === undefined) return `${key}`;
      if (typeof value === 'object') return `${key}${JSON.stringify(value)}`;
      return `${key}${value}`;
    })
    .join('');

  const computedHmac = crypto
    .createHmac('sha256', salt)
    .update(signatureString)
    .digest('hex');

  return computedHmac === signature;
}

/**
 * Verifies the HMAC-SHA256 signature from the `Hitpay-Signature` header.
 * Used by HitPay's new webhook format where the raw JSON body is signed.
 *
 * @param rawBody - The raw request body string (before JSON parsing)
 * @param signature - The value of the `Hitpay-Signature` header
 * @returns true if the signature is valid, false otherwise
 */
export function verifyHitPayHeaderSignature(rawBody: string, signature: string): boolean {
  const salt = HITPAY_SALT;

  if (!salt) {
    console.error(
      `[HitPay] HITPAY_SALT_${hitpayEnv.toUpperCase()} not configured - cannot verify webhooks`
    );
    return false;
  }

  const computedHmac = crypto
    .createHmac('sha256', salt)
    .update(rawBody)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(computedHmac, 'hex'),
      Buffer.from(signature, 'hex')
    );
  } catch {
    return false;
  }
}

// ============================================================================
// RECURRING BILLING APIs (for auto-charge subscriptions)
// ============================================================================

/**
 * Request payload for creating a HitPay recurring billing session.
 * Used to save a payment method for future automatic charges.
 */
export interface HitPayRecurringBillingRequest {
  /** Session name/identifier (e.g., "Subscription for user@example.com") */
  name: string;
  /** Customer email address */
  customer_email: string;
  /** Customer name */
  customer_name?: string;
  /** Display amount (minimum 1.00, just for display during authorization) */
  amount: number;
  /** ISO 4217 currency code (e.g., "SGD") */
  currency: string;
  /** Enable saving the payment method for future charges */
  save_payment_method: boolean;
  /** Payment methods to offer (e.g., ["card", "shopee_recurring", "grabpay_direct"]) */
  payment_methods: string[];
  /** Webhook URL for charge notifications */
  webhook?: string;
  /** URL to redirect after authorization */
  redirect_url?: string;
  /** Your reference for this recurring billing (e.g., Stripe subscription ID) */
  reference?: string;
  /** Request an embedded payment or direct link in the response (for app-based methods) */
  generate_embed?: boolean;
}

/**
 * Response from HitPay recurring billing API.
 */
export interface HitPayRecurringBillingResponse {
  /** Unique recurring billing ID (use this to charge later) */
  id: string;
  /** Business ID */
  business_id: string;
  /** Session name */
  name: string;
  /** Customer email */
  customer_email: string;
  /** Customer name */
  customer_name: string | null;
  /** Amount for display */
  amount: string;
  /** Currency code */
  currency: string;
  /** Current status */
  status: 'pending' | 'active' | 'canceled';
  /** Checkout URL for customer authorization */
  url: string;
  /** Redirect URL after authorization */
  redirect_url: string | null;
  /** Webhook URL */
  webhook: string | null;
  /** Payment methods enabled */
  payment_methods: string[];
  /** Saved card details (only present after customer authorizes) */
  card?: {
    brand: string;
    last4: string;
    country: string;
  };
  /** Saved payment method type */
  payment_method_type?: string;
  /** Reference */
  reference: string | null;
  /** Creation timestamp */
  created_at: string;
  /** Last update timestamp */
  updated_at: string;
  /** QR code data if generate_embed was true and method supports QR */
  qr_code_data?: {
    qr_code: string;
    qr_code_expiry: string | null;
  };
  /** Direct link for app-based methods (Shopee, GrabPay, TNG) */
  direct_link?: {
    direct_link_url: string;
  };
}

/**
 * Response from charging a recurring billing session.
 */
export interface HitPayChargeResponse {
  /** Payment ID for this charge */
  payment_id: string;
  /** Recurring billing ID that was charged */
  recurring_billing_id: string;
  /** Amount charged */
  amount: number;
  /** Currency */
  currency: string;
  /** Charge status */
  status: 'succeeded' | 'pending' | 'failed';
  /** Error message if failed */
  error?: string;
}

/**
 * Creates a HitPay recurring billing session to save a payment method.
 *
 * After creating the session, redirect the customer to the returned URL
 * to authorize their payment method. Once authorized, you can charge
 * the saved payment method using chargeRecurringBilling().
 *
 * @param data - Recurring billing session parameters
 * @returns The created recurring billing session
 * @throws Error if the API request fails
 *
 * @example
 * ```ts
 * const session = await createRecurringBilling({
 *   name: "Subscription for john@example.com",
 *   customer_email: "john@example.com",
 *   customer_name: "John Doe",
 *   amount: 1.00, // Display amount
 *   currency: "SGD",
 *   save_payment_method: true,
 *   payment_methods: ["shopee_recurring"],
 *   redirect_url: "https://example.com/subscribe/setup",
 *   reference: "sub_xxx",
 * });
 *
 * // Redirect customer to session.url
 * ```
 */
export async function createRecurringBilling(
  data: HitPayRecurringBillingRequest
): Promise<HitPayRecurringBillingResponse> {
  const apiKey = HITPAY_API_KEY;

  if (!apiKey) {
    throw new Error(
      `HITPAY_API_KEY_${hitpayEnv.toUpperCase()} is not set. Please configure it in your .env.local file.`
    );
  }

  // Build form data (HitPay recurring billing API uses form encoding)
  const formData = new URLSearchParams();
  formData.append('name', data.name);
  formData.append('customer_email', data.customer_email);
  if (data.customer_name) formData.append('customer_name', data.customer_name);
  formData.append('amount', data.amount.toFixed(2));
  formData.append('currency', data.currency.toUpperCase());
  formData.append('save_payment_method', data.save_payment_method ? 'true' : 'false');
  data.payment_methods.forEach((method) => {
    formData.append('payment_methods[]', method);
  });
  if (data.webhook) formData.append('webhook', data.webhook);
  if (data.redirect_url) formData.append('redirect_url', data.redirect_url);
  if (data.reference) formData.append('reference', data.reference);
  if (data.generate_embed) formData.append('generate_embed', 'true');

  const response = await fetch(`${HITPAY_API_BASE}/recurring-billing`, {
    method: 'POST',
    headers: {
      'X-BUSINESS-API-KEY': apiKey,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: formData.toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`HitPay API error (${response.status}): ${error}`);
  }

  return response.json();
}

/**
 * Charges a saved payment method from a recurring billing session.
 *
 * Use this after the customer has authorized their payment method
 * via the recurring billing checkout URL.
 *
 * @param recurringBillingId - The HitPay recurring billing session ID
 * @param amount - Amount to charge
 * @param currency - Currency code (e.g., "SGD")
 * @returns The charge result
 * @throws Error if the API request fails or charge fails
 *
 * @example
 * ```ts
 * const charge = await chargeRecurringBilling(
 *   "9741164c-06a1-4dd7-a649-72cca8f9603a",
 *   29.90,
 *   "SGD"
 * );
 *
 * if (charge.status === "succeeded") {
 *   // Record payment in Stripe
 * }
 * ```
 */
export async function chargeRecurringBilling(
  recurringBillingId: string,
  amount: number,
  currency: string
): Promise<HitPayChargeResponse> {
  const apiKey = HITPAY_API_KEY;

  if (!apiKey) {
    throw new Error(
      `HITPAY_API_KEY_${hitpayEnv.toUpperCase()} is not set. Please configure it in your .env.local file.`
    );
  }

  const formData = new URLSearchParams();
  formData.append('amount', amount.toFixed(2));
  formData.append('currency', currency.toUpperCase());

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  let response: Response;
  try {
    response = await fetch(
      `${HITPAY_API_BASE}/charge/recurring-billing/${recurringBillingId}`,
      {
        method: 'POST',
        headers: {
          'X-BUSINESS-API-KEY': apiKey,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString(),
        signal: controller.signal,
      }
    );
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`HitPay charge error (${response.status}): ${error}`);
  }

  return response.json();
}

/**
 * Retrieves the status of a HitPay recurring billing session.
 *
 * Use this to check if a customer has authorized their payment method
 * and to retrieve saved card details.
 *
 * @param recurringBillingId - The HitPay recurring billing session ID
 * @returns The recurring billing session details
 * @throws Error if the API request fails
 *
 * @example
 * ```ts
 * const session = await getRecurringBilling("9741164c-...");
 * if (session.status === "active" && session.card) {
 *   console.log(`Card saved: ${session.card.brand} ending in ${session.card.last4}`);
 * }
 * ```
 */
export async function getRecurringBilling(
  recurringBillingId: string
): Promise<HitPayRecurringBillingResponse> {
  const apiKey = HITPAY_API_KEY;

  if (!apiKey) {
    throw new Error(
      `HITPAY_API_KEY_${hitpayEnv.toUpperCase()} is not set. Please configure it in your .env.local file.`
    );
  }

  const response = await fetch(
    `${HITPAY_API_BASE}/recurring-billing/${recurringBillingId}`,
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
