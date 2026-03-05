# CLAUDE.md - Standalone Stripe CPM Integration!

This file contains context and learnings for AI assistants working on this codebase.

## Project Overview

This is a **standalone** Stripe Custom Payment Methods POC integrating multiple HitPay payment methods (PayNow, ShopeePay, etc.) as external payment providers within Stripe's Payment Element. This version uses only standard Stripe account keys (no platform/connect architecture).

**Supports multiple Custom Payment Methods** - each Stripe CPM type maps to a corresponding HitPay payment method via a central configuration file.

## Key Architecture

### Standalone vs Platform Version

This project is the **standalone version** where:
- A single Stripe account is used for all operations
- The developer integrates HitPay directly with their own proxy backend
- No SDK or platform abstraction layer
- Simpler architecture for direct integrations

## Key Learnings

### Stripe Custom Payment Methods

1. **Multiple CPMs via Configuration File**
   - All CPM-to-HitPay mappings are defined in `/config/payment-methods.ts`
   - Each entry maps a Stripe CPM Type ID to a HitPay payment method
   - The `chargeAutomatically` flag indicates if the method supports auto-charge subscriptions
   ```typescript
   // config/payment-methods.ts
   export const CUSTOM_PAYMENT_METHODS = [
     {
       id: 'cpmt_xxx',                    // Stripe CPM Type ID
       hitpayMethod: 'paynow_online',     // HitPay one-time method
       displayName: 'PayNow',
       chargeAutomatically: false,        // QR-based, no tokenization
     },
     {
       id: 'cpmt_yyy',
       hitpayMethod: 'shopee_pay',
       hitpayRecurringMethod: 'shopee_recurring',  // HitPay recurring method
       displayName: 'ShopeePay',
       chargeAutomatically: true,         // Supports save & charge
     },
   ];
   ```

2. **Custom Payment Methods are client-side configured**
   - NOT set via `payment_method_types` in PaymentIntent
   - Configured via `customPaymentMethods` option in Elements provider
   - All configured CPMs are automatically loaded from the config file
   ```javascript
   const elementsOptions = {
     clientSecret,
     customPaymentMethods: CUSTOM_PAYMENT_METHODS.map((pm) => ({
       id: pm.id,
       options: { type: 'static' },
     })),
   };
   ```

3. **Custom Payment Method Types**
   - `static`: Shows a placeholder message, payment handled externally
   - `embedded`: Allows embedding custom content (requires Stripe gating/approval)
   - The `embedded` type requires reaching out to Stripe for access

4. **Payment Records API**
   - External payments are recorded via `stripe.paymentRecords.reportPayment()`
   - PaymentIntent remains "Incomplete" - this is expected for external payments
   - Payment Records are separate objects with `prec_*` IDs

5. **Beta Flag Required**
   - Load Stripe.js with beta flag for custom payment methods:
   ```javascript
   loadStripe(publishableKey, {
     betas: ['custom_payment_methods_beta_1'],
   });
   ```

### HitPay Integration

1. **API Endpoints**
   - Sandbox: `https://api.sandbox.hit-pay.com/v1`
   - Production: `https://api.hit-pay.com/v1`

2. **Payment Request Creation**
   - POST `/payment-requests` with `generate_qr: true`
   - Returns `qr_code_data.qr_code` containing the QR code data

3. **Status Checking**
   - GET `/payment-requests/{id}`
   - Status values: `pending`, `completed`, `failed`, `expired`

## File Structure

```
/config
  payment-methods.ts  # CPM-to-HitPay mapping configuration (ADD NEW METHODS HERE)
                      # Includes chargeAutomatically flag for auto-charge support

/lib
  stripe.ts          # Server-side Stripe client
  stripe-client.ts   # Client-side Stripe.js loader with beta flag
  hitpay.ts          # HitPay API client (one-time + recurring billing)
  store.ts           # Zustand store for cart state + subscription products

/components
  CheckoutForm.tsx              # Main checkout form with Payment Element and QR code
  SubscriptionCheckoutForm.tsx  # Subscription checkout form (out-of-band flow)
  ProductCard.tsx               # Product display component (supports subscriptions)
  CartIcon.tsx                  # Shopping cart icon

/app
  page.tsx           # Home page with product grid + subscriptions section
  cart/page.tsx      # Shopping cart
  checkout/page.tsx  # Checkout page with Stripe Elements
  success/page.tsx   # Payment success page

  subscriptions/page.tsx        # Subscription products listing
  subscribe/page.tsx            # Subscription checkout (billing type toggle)
  subscribe/setup/page.tsx      # HitPay redirect handler (auto-charge)
  subscribe/success/page.tsx    # Subscription success page

  /api
    products/route.ts               # Fetch products from Stripe (GET ?type=recurring|one_time)
    create-payment-intent/route.ts  # Create Stripe PaymentIntent (one-time)
    create-subscription/route.ts    # Create Stripe Subscription (supports billingType param)
    hitpay/create/route.ts          # Create HitPay payment request (one-time)
    hitpay/status/route.ts          # Check HitPay payment status
    hitpay/recurring-billing/
      create/route.ts               # Create HitPay recurring billing session (auto-charge)
      charge/route.ts               # Charge saved payment method
    subscription/
      pay-invoice/route.ts          # Mark invoice as paid (out-of-band)
      charge-invoice/route.ts       # Charge invoice via HitPay (auto-charge)
    stripe/
      webhook/route.ts              # Stripe webhook for auto-charge renewals
    payment/check-status/route.ts   # Check HitPay status and record to Stripe
```

## Environment Variables

```bash
# Stripe (Standard Account)
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_xxx
STRIPE_SECRET_KEY=sk_test_xxx

# Stripe Webhook Secret (for auto-charge subscription renewals)
# Get from Stripe Dashboard > Developers > Webhooks > Your endpoint > Signing secret
STRIPE_WEBHOOK_SECRET=whsec_xxx

# HitPay
HITPAY_API_KEY=xxx
HITPAY_SALT=xxx
NEXT_PUBLIC_HITPAY_ENV=sandbox
```

**Note:** CPM Type IDs are configured in `/config/payment-methods.ts`, not via environment variables.
**Note:** Subscription products are fetched automatically from Stripe Dashboard - no env variables needed!

## API Flow (One-Time Payments)

```
1. User loads checkout page
2. Frontend loads Stripe.js with standard account publishable key
3. Frontend calls /api/create-payment-intent
   → Creates PaymentIntent on standard account
4. PaymentElement renders with ALL configured CPM types from config
5. User selects a custom payment method (PayNow, ShopeePay, etc.)
6. Frontend detects which CPM is selected and looks up HitPay method from config
7. Frontend calls /api/hitpay/create with { paymentMethod: 'paynow_online' | 'shopee_pay' | ... }
   → Creates HitPay payment request with QR (if supported)
   → If QR not available, returns checkout URL as fallback
8. Frontend displays QR code OR checkout link button
9. User completes payment via QR scan or checkout page
10. Frontend polls /api/payment/check-status every 3s
    → Server checks HitPay status
    → When completed, creates PaymentMethod and PaymentRecord
11. Frontend redirects to /success
```

## API Flow (Subscriptions)

The demo supports two subscription billing types:

### Out-of-Band Invoices (Pay Each Invoice)

User pays each invoice manually via CPM (works with all payment methods).

```
1. User visits /subscriptions page
   → Frontend: GET /api/products?type=recurring
2. User clicks "Subscribe" and navigates to /subscribe?priceId=xxx
3. User selects "Pay Each Invoice" billing type
4. Frontend: POST /api/create-subscription { billingType: 'out_of_band' }
   → Creates Customer and Subscription with collection_method: 'send_invoice'
   → Returns clientSecret from invoice's PaymentIntent
5. Payment Element loads with all CPMs
6. User selects CPM (PayNow, ShopeePay, etc.)
7. Frontend creates HitPay payment request and shows QR code
8. User scans QR and pays
9. Frontend polls HitPay status
10. On completion, calls /api/subscription/pay-invoice
    → Marks invoice as paid_out_of_band
11. Redirect to /subscribe/success
12. On next billing cycle, user receives new invoice and pays manually
```

### Auto-Charge (Own Processor)

HitPay automatically charges saved payment method on renewals.
Only works with CPMs that have `chargeAutomatically: true` (e.g., ShopeePay, GrabPay).

```
1. User visits /subscriptions page
2. User clicks "Subscribe" and navigates to /subscribe?priceId=xxx
3. User selects "Auto-Charge" billing type and CPM (e.g., ShopeePay)
4. Frontend: POST /api/create-subscription { billingType: 'charge_automatically' }
   → Creates Customer and Subscription with collection_method: 'charge_automatically'
   → Returns subscription info for HitPay setup
5. Frontend: POST /api/hitpay/recurring-billing/create
   → Creates HitPay recurring billing session
   → Stores recurring billing ID in customer metadata
6. User is redirected to HitPay to authorize payment method
7. After authorization, HitPay redirects to /subscribe/setup
8. Setup page: POST /api/subscription/charge-invoice
   → Charges first invoice via HitPay saved payment method
   → Records payment in Stripe via Payment Records API
9. Redirect to /subscribe/success
10. On next billing cycle:
    → Stripe creates invoice and fires `invoice.payment_attempt_required` webhook
    → Stripe webhook handler at /api/stripe/webhook receives event
    → Handler charges saved HitPay payment method automatically
    → Records payment in Stripe via Payment Records API
    → Marks invoice as paid
```

### HitPay Auto-Charge Supported Methods

| Method | HitPay Recurring Method | chargeAutomatically |
|--------|-------------------------|---------------------|
| PayNow | N/A (QR-based) | false |
| ShopeePay | shopee_recurring | true |
| GrabPay | grabpay_direct | true |
| Cards | card | true |

## Adding a New Payment Method

To add a new custom payment method (e.g., GrabPay):

1. **Create CPM Type in Stripe Dashboard**
   - Go to Stripe Dashboard > Settings > Payment Methods
   - Create a new Custom Payment Method Type
   - Copy the ID (starts with `cpmt_`)

2. **Add to Configuration**
   - Open `/config/payment-methods.ts`
   - Add a new entry to `CUSTOM_PAYMENT_METHODS`:
   ```typescript
   {
     id: 'cpmt_xxx',                    // Your CPM Type ID from Stripe
     hitpayMethod: 'grabpay',           // HitPay one-time method
     hitpayRecurringMethod: 'grabpay_direct',  // (Optional) HitPay recurring method
     displayName: 'GrabPay',
     chargeAutomatically: true,         // Set true if method supports tokenization
   },
   ```

3. **Available HitPay Payment Methods**

   **One-Time Payments:**
   - `paynow_online` - PayNow QR (no auto-charge)
   - `shopee_pay` - ShopeePay
   - `grabpay` - GrabPay
   - `fpx` - FPX (Malaysia)
   - `zip` - Zip (BNPL)
   - `atome` - Atome (BNPL)

   **Auto-Charge (Recurring Methods):**
   - `card` - Credit/Debit cards
   - `shopee_recurring` - ShopeePay recurring
   - `grabpay_direct` - GrabPay recurring

4. **Test the Integration**
   - Ensure the payment method is enabled in your HitPay account
   - Some methods may not support QR codes (fallback to checkout URL)
   - For auto-charge methods, test the recurring billing flow

## Adding a Subscription Product

Subscription products are fetched **automatically** from your Stripe Dashboard - no code changes needed!

1. **Create Product and Price in Stripe Dashboard**
   - Go to Stripe Dashboard > Products > Add Product
   - Enter product name, description, and add an image
   - Under Pricing, select "Recurring"
   - Set the price and billing interval (monthly/yearly)
   - Click Save

2. **That's it!**
   - The product will automatically appear on `/subscriptions` and the home page
   - No environment variables or code changes required

3. **Test the Subscription**
   - Use Stripe test cards (4242 4242 4242 4242)
   - Check Stripe Dashboard > Subscriptions for the new subscription

## Testing

1. Use HitPay sandbox for testing
2. Use "Complete Mock Payment" link to simulate payment completion
3. For card testing, use Stripe test cards (4242 4242 4242 4242)
4. Note: Some payment methods may not be available in sandbox mode
5. For subscription testing, check Stripe Dashboard > Billing > Subscriptions

### Testing Auto-Charge Subscriptions

1. Select "Auto-Charge" billing type on subscribe page
2. Choose a CPM with `chargeAutomatically: true` (e.g., ShopeePay)
3. Complete the HitPay authorization flow
4. Check that:
   - Customer metadata has `hitpay_recurring_billing_id`
   - First invoice is marked as paid
   - Subscription is active in Stripe Dashboard

### Testing Out-of-Band Subscriptions

1. Select "Pay Each Invoice" billing type on subscribe page
2. Choose any CPM (PayNow, ShopeePay, etc.)
3. Scan QR code and complete payment
4. Check that:
   - Invoice is marked as `paid_out_of_band`
   - Payment Record created in Stripe
   - Subscription is active

## Stripe Webhook Setup (Auto-Charge Renewals)

The Stripe webhook at `/api/stripe/webhook` automatically handles subscription renewals for auto-charge subscriptions. When Stripe creates a new invoice, it fires the `invoice.payment_attempt_required` event, and the webhook charges the saved HitPay payment method.

### Setup Steps

1. **Deploy your app** to get a public URL (e.g., Vercel, Railway, etc.)

2. **Create webhook in Stripe Dashboard:**
   - Go to Stripe Dashboard > Developers > Webhooks
   - Click "Add endpoint"
   - Enter your webhook URL: `https://yoursite.com/api/stripe/webhook`
   - Select event: `invoice.payment_attempt_required`
   - Click "Add endpoint"

3. **Copy the signing secret:**
   - Click on your newly created endpoint
   - Under "Signing secret", click "Reveal"
   - Copy the `whsec_xxx` value

4. **Add to environment variables:**
   ```bash
   STRIPE_WEBHOOK_SECRET=whsec_xxx
   ```

### Local Testing with Stripe CLI

```bash
# Install Stripe CLI and login
stripe login

# Forward webhooks to local server
stripe listen --forward-to localhost:3000/api/stripe/webhook

# In another terminal, trigger a test event
stripe trigger invoice.payment_attempt_required
```

### Webhook Flow

```
Stripe creates invoice (subscription renewal)
        ↓
Stripe fires invoice.payment_attempt_required
        ↓
/api/stripe/webhook receives event
        ↓
Verifies signature with STRIPE_WEBHOOK_SECRET
        ↓
Checks customer has hitpay_recurring_billing_id
        ↓
Calls chargeRecurringBilling() via HitPay
        ↓
Records payment via Payment Records API
        ↓
Marks invoice as paid_out_of_band
        ↓
Returns 200 OK
```

## Common Issues

### Custom Payment Method not showing
- Ensure CPM type is created and ENABLED in your Stripe Dashboard
- Add the beta flag when loading Stripe.js
- Check the CPM Type ID in `/config/payment-methods.ts` matches your Stripe Dashboard
- Verify the CPM is added to the `CUSTOM_PAYMENT_METHODS` array

### "embedded" type not working
- The `embedded` type requires special Stripe gating
- Contact Stripe for access to embedded custom payment methods

### PaymentIntent shows as "Incomplete"
- This is expected behavior for external payments
- Check PaymentIntent metadata for `external_payment_status: completed`
- Check Stripe Dashboard > Payments > Payment Records

### HitPay validation error (422)
- Error: "The selected payment method is unavailable for your account"
- Ensure the payment method is enabled in your HitPay account settings
- Some methods are not available in sandbox mode
- The UI will show an error and fallback checkout link if available

### QR code not showing
- Not all HitPay payment methods support QR codes
- If QR is unavailable, a "Complete Payment via [Method]" button will appear
- Click this button to complete payment on HitPay's checkout page
