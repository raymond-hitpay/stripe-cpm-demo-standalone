# CLAUDE.md - Standalone Stripe CPM Integration

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
   ```typescript
   // config/payment-methods.ts
   export const CUSTOM_PAYMENT_METHODS = [
     {
       id: 'cpmt_xxx',           // Stripe CPM Type ID
       hitpayMethod: 'paynow_online',  // HitPay payment method
       displayName: 'PayNow',
     },
     {
       id: 'cpmt_yyy',
       hitpayMethod: 'shopee_pay',
       displayName: 'ShopeePay',
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

/lib
  stripe.ts          # Server-side Stripe client
  stripe-client.ts   # Client-side Stripe.js loader with beta flag
  hitpay.ts          # HitPay API client functions
  store.ts           # Zustand store for cart state

/components
  CheckoutForm.tsx   # Main checkout form with Payment Element and QR code
  ProductCard.tsx    # Product display component
  CartIcon.tsx       # Shopping cart icon

/app
  page.tsx           # Home page with product grid
  cart/page.tsx      # Shopping cart
  checkout/page.tsx  # Checkout page with Stripe Elements
  success/page.tsx   # Payment success page

  /api
    create-payment-intent/route.ts  # Create Stripe PaymentIntent
    hitpay/create/route.ts          # Create HitPay payment request (accepts paymentMethod param)
    payment/check-status/route.ts   # Check HitPay status and record to Stripe
```

## Environment Variables

```bash
# Stripe (Standard Account)
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_xxx
STRIPE_SECRET_KEY=sk_test_xxx

# HitPay
HITPAY_API_KEY=xxx
HITPAY_SALT=xxx
NEXT_PUBLIC_HITPAY_ENV=sandbox
```

**Note:** CPM Type IDs are configured in `/config/payment-methods.ts`, not via environment variables.

## API Flow

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
     id: 'cpmt_xxx',  // Your CPM Type ID from Stripe
     hitpayMethod: 'grabpay',
     displayName: 'GrabPay',
   },
   ```

3. **Available HitPay Payment Methods**
   - `paynow_online` - PayNow QR
   - `shopee_pay` - ShopeePay
   - `grabpay` - GrabPay
   - `fpx` - FPX (Malaysia)
   - `zip` - Zip (BNPL)
   - `atome` - Atome (BNPL)
   - See HitPay API docs for full list

4. **Test the Integration**
   - Ensure the payment method is enabled in your HitPay account
   - Some methods may not support QR codes (fallback to checkout URL)

## Testing

1. Use HitPay sandbox for testing
2. Use "Complete Mock Payment" link to simulate payment completion
3. For card testing, use Stripe test cards (4242 4242 4242 4242)
4. Note: Some payment methods may not be available in sandbox mode

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
