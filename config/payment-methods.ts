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
 * 3. Add a new entry to PAYMENT_METHOD_DEFINITIONS below using ids.<env>
 * 4. Ensure the HitPay payment method is enabled in your HitPay account
 *
 * Each entry defines:
 * - ids: Per-environment Stripe CPM Type IDs (sandbox/staging/production)
 * - hitpayMethod: The HitPay payment method identifier (see list below)
 * - hitpayRecurringMethod: (Optional) HitPay method for recurring billing if different
 * - displayName: Human-readable name shown in UI and logs
 * - supportsOneTime: Whether this method supports one-time payments (shop + out-of-band invoices)
 * - chargeAutomatically: Whether this method supports auto-charge subscriptions
 *
 * PAYMENT SCENARIOS:
 * ------------------
 * 1. Shop Checkout (one-time): Uses CPMs with supportsOneTime: true
 * 2. Out-of-Band Invoices: Uses CPMs with supportsOneTime: true (user pays each invoice)
 * 3. Auto-Charge Subscriptions: Uses CPMs with chargeAutomatically: true
 *    - HitPay tokenizes and charges saved payment method automatically
 *    - Requires HitPay tokenization support (cards, ShopeePay, GrabPay)
 *
 * ENVIRONMENT RESOLUTION:
 * -----------------------
 * The active environment is read from NEXT_PUBLIC_HITPAY_ENV (sandbox | staging | production).
 * Entries without an ID for the active environment are automatically excluded.
 */

export interface CustomPaymentMethodConfig {
  /** Stripe Custom Payment Method Type ID (cpmt_xxx) — resolved for the active env */
  id: string;
  /** HitPay payment method identifier for one-time payments */
  hitpayMethod: string;
  /** HitPay method for recurring billing (if different from hitpayMethod) */
  hitpayRecurringMethod?: string;
  /** Display name for logs and debugging */
  displayName: string;
  /** Whether this method supports one-time payments (shop checkout + out-of-band subscription invoices) */
  supportsOneTime: boolean;
  /** Whether this method supports auto-charge subscriptions via HitPay tokenization */
  chargeAutomatically: boolean;
}

type HitPayEnv = 'sandbox' | 'staging' | 'production';

interface EnvIds {
  sandbox?: string;
  staging?: string;
  production?: string;
}

interface CustomPaymentMethodDefinition extends Omit<CustomPaymentMethodConfig, 'id'> {
  ids: EnvIds;
}

// =============================================================================
// STRIPE NATIVE RECURRING METHODS
// =============================================================================

/**
 * Stripe native payment methods that support recurring/saved payment methods.
 * These will be shown in the auto-charge Payment Element alongside HitPay CPMs.
 *
 * Add/remove methods as needed based on your region and requirements.
 * Methods NOT in this list (e.g., paynow, alipay, grabpay) will be hidden
 * from the auto-charge flow.
 *
 * @see https://stripe.com/docs/payments/payment-methods/integration-options
 */
export const STRIPE_RECURRING_METHODS: string[] = [
  'card',           // Credit/debit cards (global)
  // 'sepa_debit',  // SEPA Direct Debit (Europe)
  // 'us_bank_account', // ACH (US)
  // 'bacs_debit',  // Bacs Direct Debit (UK)
  // 'au_becs_debit', // BECS Direct Debit (Australia)
  // 'link',        // Stripe Link
];

// =============================================================================
// HITPAY CUSTOM PAYMENT METHODS
// =============================================================================

/**
 * List of all configured custom payment methods.
 *
 * ============================================================================
 * AVAILABLE HITPAY PAYMENT METHODS
 * ============================================================================
 *
 * ONE-TIME PAYMENTS (all methods):
 * - paynow_online    : PayNow QR (supports QR code)
 * - grabpay          : GrabPay
 * - shopee_pay       : ShopeePay
 * - zip              : Zip (Buy Now Pay Later)
 * - atome            : Atome (Buy Now Pay Later)
 * - fpx              : FPX bank transfer (Malaysia)
 * - grabpay_my       : GrabPay Malaysia
 * - boost            : Boost (Malaysia)
 * - touch_n_go       : Touch 'n Go (Malaysia)
 *
 * AUTO-CHARGE SUBSCRIPTIONS (methods with tokenization support):
 * - card             : Credit/Debit cards (Visa, Mastercard, Amex)
 * - shopee_recurring : ShopeePay (recurring method name)
 * - grabpay_direct   : GrabPay (recurring method name)
 *
 * Note: Not all methods support QR codes. If QR is unavailable,
 * the UI will show a checkout link button as fallback.
 *
 * @see https://hit-pay.com/docs/api-reference for full list
 * ============================================================================
 */
const PAYMENT_METHOD_DEFINITIONS: CustomPaymentMethodDefinition[] = [
  // {
  //   ids: {
  //     sandbox:    'cpmt_1SnWg7H0EH9sk7Na3BI20zou',
  //     staging:    'cpmt_1SnWg7H0EH9sk7Na3BI20zou',
  //     production: 'cpmt_1T74YBAMHowMCIhZmarAxl5e',
  //   },
  //   hitpayMethod: 'paynow_online',
  //   displayName: 'PayNow',
  //   supportsOneTime: true,       // Shop checkout + out-of-band invoices
  //   chargeAutomatically: false,  // QR-based, no tokenization support
  // },
  {
    ids: {
      sandbox:    'cpmt_1SrU7yH0EH9sk7Nau7jdZbFp',
      staging:    'cpmt_1SrU7yH0EH9sk7Nau7jdZbFp',
      production: 'cpmt_1T7SetAMHowMCIhZxsx3LL7s',
    },
    hitpayMethod: 'shopee_pay',
    displayName: 'ShopeePay',
    supportsOneTime: true,      // Not for one-time payments
    chargeAutomatically: true,   // Supports save & charge via HitPay tokenization
  },
  {
    ids: {
      sandbox:    'cpmt_1T7SbgH0EH9sk7NaK7rrZlWw',
      staging:    'cpmt_1T7SbgH0EH9sk7NaK7rrZlWw',
      production: 'cpmt_1T7SbuAMHowMCIhZ67WNWUfF',
    },
    hitpayMethod: 'atome_qr',
    displayName: 'Atome',
    supportsOneTime: true,       // Shop checkout + out-of-band invoices
    chargeAutomatically: false,  // QR-based, no tokenization support
  },
  {
    ids: {
      sandbox:    'cpmt_1T7Sk5H0EH9sk7Naz1EnUWj1',
      staging:    'cpmt_1T7Sk5H0EH9sk7Naz1EnUWj1',
      production: 'cpmt_1T7SjcAMHowMCIhZDTzEpdKW',
    },
    hitpayMethod: 'paynow_online',
    displayName: 'GCash',
    supportsOneTime: true,      // Not for one-time payments
    chargeAutomatically: false,   // Supports save & charge via HitPay tokenization
  },
  {
    ids: {
      sandbox:    'cpmt_1T74HqH0EH9sk7NaOPh7nxOr',
      staging:    'cpmt_1T74HqH0EH9sk7NaOPh7nxOr',
      production: 'cpmt_1T72UHAMHowMCIhZlcjUE1Fz',
    },
    hitpayMethod: 'qrph_netbank',
    displayName: 'QR Ph',
    supportsOneTime: true,       // Shop checkout + out-of-band invoices
    chargeAutomatically: false,  // QR-based, no tokenization support
  },
  {
    ids: {
      sandbox:    'cpmt_1T74IoH0EH9sk7NadZTkLvi5',
      staging:    'cpmt_1T74IoH0EH9sk7NadZTkLvi5',
      production: 'cpmt_1T72ViAMHowMCIhZQmXzU6RK',
    },
    hitpayMethod: 'ifpay_qris',
    displayName: 'QRIS',
    supportsOneTime: true,       // Shop checkout + out-of-band invoices
    chargeAutomatically: false,  // QR-based, no tokenization support
  },
  {
    ids: {
      sandbox:    'cpmt_1T7SVpH0EH9sk7NaXCBpoNPf',
      staging:    'cpmt_1T7SVpH0EH9sk7NaXCBpoNPf',
      production: 'cpmt_1T72baAMHowMCIhZQz0vBaH0',
    },
    hitpayMethod: 'zalopay',
    displayName: 'ZaloPay',
    supportsOneTime: true,       // Shop checkout + out-of-band invoices
    chargeAutomatically: false,  // QR-based, no tokenization support
  },
  {
    ids: {
      sandbox:    'cpmt_1T7SXSH0EH9sk7NaUKV9Ngsw',
      staging:    'cpmt_1T7SXSH0EH9sk7NaUKV9Ngsw',
      production: 'cpmt_1T7SYhAMHowMCIhZr6WfpM6E',
    },
    hitpayMethod: 'duitnow',
    displayName: 'DuitNow',
    supportsOneTime: true,       // Shop checkout + out-of-band invoices
    chargeAutomatically: false,  // QR-based, no tokenization support
  },

  // {
  //   ids: {
  //     sandbox:    'cpmt_1T4caMH0EH9sk7Na1F8yoeOy',
  //     staging:    '',
  //     production: '',
  //   },
  //   hitpayMethod: 'card',
  //   displayName: 'Cards (by HitPay)',
  //   supportsOneTime: false,      // Not for one-time payments
  //   chargeAutomatically: true,   // Supports save & charge via HitPay tokenization
  // },

  // Add more payment methods here as needed:
  // {
  //   ids: {
  //     sandbox:    'cpmt_sandbox_xxx',
  //     staging:    'cpmt_staging_xxx',
  //     production: 'cpmt_prod_xxx',
  //   },
  //   hitpayMethod: 'grabpay',
  //   hitpayRecurringMethod: 'grabpay_direct',
  //   displayName: 'GrabPay',
  //   supportsOneTime: true,      // Shop checkout + out-of-band invoices
  //   chargeAutomatically: true,  // Supports auto-charge subscriptions
  // },
];

const activeEnv: HitPayEnv =
  (process.env.NEXT_PUBLIC_HITPAY_ENV as HitPayEnv) || 'sandbox';

export const CUSTOM_PAYMENT_METHODS: CustomPaymentMethodConfig[] =
  PAYMENT_METHOD_DEFINITIONS
    .filter((def) => !!def.ids[activeEnv])
    .map(({ ids, ...rest }) => ({ ...rest, id: ids[activeEnv]! }));

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

/**
 * Get CPMs that support auto-charge subscriptions (chargeAutomatically: true)
 * These methods support HitPay tokenization for recurring billing.
 */
export function getAutoChargeCpms(): CustomPaymentMethodConfig[] {
  return CUSTOM_PAYMENT_METHODS.filter((pm) => pm.chargeAutomatically);
}

/**
 * Get CPM Type IDs for auto-charge subscriptions
 */
export function getAutoChargeCpmTypeIds(): string[] {
  return getAutoChargeCpms().map((pm) => pm.id);
}

/**
 * Get all CPMs for invoice-based subscriptions (all CPMs support this)
 * Users pay each invoice manually via QR code or checkout link.
 */
export function getInvoiceCpms(): CustomPaymentMethodConfig[] {
  return CUSTOM_PAYMENT_METHODS;
}

/**
 * Get the HitPay recurring method for a CPM (for auto-charge subscriptions)
 * Returns hitpayRecurringMethod if set, otherwise falls back to hitpayMethod
 */
export function getHitpayRecurringMethod(cpmTypeId: string): string | null {
  const config = CUSTOM_PAYMENT_METHODS.find((pm) => pm.id === cpmTypeId);
  if (!config) return null;
  return config.hitpayRecurringMethod || config.hitpayMethod;
}

/**
 * Check if a CPM supports auto-charge subscriptions
 */
export function supportsAutoCharge(cpmTypeId: string): boolean {
  const config = CUSTOM_PAYMENT_METHODS.find((pm) => pm.id === cpmTypeId);
  return config?.chargeAutomatically ?? false;
}

/**
 * Get CPMs that support one-time payments
 */
export function getOneTimeCpms(): CustomPaymentMethodConfig[] {
  return CUSTOM_PAYMENT_METHODS.filter((pm) => pm.supportsOneTime);
}

/**
 * Get CPM Type IDs for one-time payments
 */
export function getOneTimeCpmTypeIds(): string[] {
  return getOneTimeCpms().map((pm) => pm.id);
}

