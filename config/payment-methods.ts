/**
 * Payment Methods Configuration
 * =============================
 *
 * This is the SINGLE SOURCE OF TRUTH for mapping Stripe Custom Payment Method
 * Type IDs to their corresponding HitPay payment methods.
 *
 * QUICK START - Adding a new payment method:
 * ------------------------------------------
 * 1. Go to Stripe Dashboard > Settings > Payment Methods
 * 2. Create a new Custom Payment Method Type, copy the ID (cpmt_xxx)
 * 3. Add a new entry to CUSTOM_PAYMENT_METHODS array below
 * 4. Ensure the HitPay payment method is enabled in your HitPay account
 *
 * Each entry defines:
 * - id: The Stripe CPM Type ID (cpmt_xxx) from your Stripe Dashboard
 * - hitpayMethod: The HitPay payment method identifier (see list below)
 * - displayName: Human-readable name shown in UI and logs
 */

export interface CustomPaymentMethodConfig {
  /** Stripe Custom Payment Method Type ID (cpmt_xxx) */
  id: string;
  /** HitPay payment method identifier */
  hitpayMethod: string;
  /** Display name for logs and debugging */
  displayName: string;
}

/**
 * List of all configured custom payment methods.
 *
 * ============================================================================
 * AVAILABLE HITPAY PAYMENT METHODS
 * ============================================================================
 *
 * Singapore:
 * - paynow_online    : PayNow QR (supports QR code)
 * - grabpay          : GrabPay
 * - shopee_pay       : ShopeePay
 * - zip              : Zip (Buy Now Pay Later)
 * - atome            : Atome (Buy Now Pay Later)
 *
 * Malaysia:
 * - fpx              : FPX bank transfer
 * - grabpay_my       : GrabPay Malaysia
 * - boost            : Boost
 * - touch_n_go       : Touch 'n Go
 *
 * Note: Not all methods support QR codes. If QR is unavailable,
 * the UI will show a checkout link button as fallback.
 *
 * @see https://hit-pay.com/docs/api-reference for full list
 * ============================================================================
 */
export const CUSTOM_PAYMENT_METHODS: CustomPaymentMethodConfig[] = [
  {
    id: 'cpmt_1SzTJ0H0EHxX2LBWAwUZfo1y',
    hitpayMethod: 'paynow_online',
    displayName: 'PayNow',
  },
  {
    id: 'cpmt_1SzVcIH0EHxX2LBWBPEbfzKA',
    hitpayMethod: 'shopee_pay',
    displayName: 'ShopeePay',
  },
  // Add more payment methods here as needed:
  // {
  //   id: 'cpmt_xxx',
  //   hitpayMethod: 'grabpay',
  //   displayName: 'GrabPay',
  // },
];

/**
 * Get all CPM Type IDs for Stripe Elements configuration
 */
export function getAllCpmTypeIds(): string[] {
  return CUSTOM_PAYMENT_METHODS.map((pm) => pm.id);
}

/**
 * Get HitPay payment method for a given CPM Type ID
 * @returns The HitPay method string, or null if not found
 */
export function getHitpayMethod(cpmTypeId: string): string | null {
  const config = CUSTOM_PAYMENT_METHODS.find((pm) => pm.id === cpmTypeId);
  return config?.hitpayMethod || null;
}

/**
 * Get the full config for a CPM Type ID
 */
export function getPaymentMethodConfig(cpmTypeId: string): CustomPaymentMethodConfig | null {
  return CUSTOM_PAYMENT_METHODS.find((pm) => pm.id === cpmTypeId) || null;
}

/**
 * Check if a payment method type is a custom payment method
 */
export function isCustomPaymentMethod(paymentMethodType: string): boolean {
  return CUSTOM_PAYMENT_METHODS.some((pm) => pm.id === paymentMethodType);
}
