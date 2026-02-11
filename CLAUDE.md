# CLAUDE.md - Standalone Stripe CPM Integration

This file contains context and learnings for AI assistants working on this codebase.

## Project Overview

This is a **standalone** Stripe Custom Payment Methods POC integrating HitPay PayNow as an external payment provider within Stripe's Payment Element. This version uses only standard Stripe account keys (no platform/connect architecture).

## Key Architecture

### Standalone vs Platform Version

This project is the **standalone version** where:
- A single Stripe account is used for all operations
- The developer integrates HitPay directly with their own proxy backend
- No SDK or platform abstraction layer
- Simpler architecture for direct integrations

## Key Learnings

### Stripe Custom Payment Methods

1. **Custom Payment Methods are client-side configured**
   - NOT set via `payment_method_types` in PaymentIntent
   - Configured via `customPaymentMethods` option in Elements provider
   ```javascript
   const elementsOptions = {
     clientSecret: clientSecret,
     customPaymentMethods: [
       {
         id: 'cpmt_xxx', // Custom Payment Method Type ID
         options: {
           type: 'embedded', // Allows embedding custom content
           onContainerMounted: (container) => setEmbedContainer(container),
           onContainerUnmounted: () => setEmbedContainer(null),
         },
       },
     ],
   };
   ```

2. **Custom Payment Method Types**
   - `static`: Shows a placeholder message, payment handled externally
   - `embedded`: Allows embedding custom content (requires Stripe gating/approval)
   - The `embedded` type requires reaching out to Stripe for access

3. **Payment Records API**
   - External payments are recorded via `stripe.paymentRecords.reportPayment()`
   - PaymentIntent remains "Incomplete" - this is expected for external payments
   - Payment Records are separate objects with `prec_*` IDs

4. **Beta Flag Required**
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
    hitpay/create/route.ts          # Create HitPay payment request
    payment/check-status/route.ts   # Check HitPay status and record to Stripe
```

## Environment Variables

```bash
# Stripe (Standard Account)
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_xxx
STRIPE_SECRET_KEY=sk_test_xxx
NEXT_PUBLIC_CPM_TYPE_ID=cpmt_xxx

# HitPay
HITPAY_API_KEY=xxx
HITPAY_SALT=xxx
NEXT_PUBLIC_HITPAY_ENV=sandbox
```

## API Flow

```
1. User loads checkout page
2. Frontend loads Stripe.js with standard account publishable key
3. Frontend calls /api/create-payment-intent
   → Creates PaymentIntent on standard account
4. PaymentElement renders with CPM type
5. User selects PayNow (custom payment method)
6. Frontend calls /api/hitpay/create
   → Creates HitPay payment request with QR
7. Frontend displays QR code (embedded in Stripe's container)
8. User scans and pays via PayNow
9. Frontend polls /api/payment/check-status every 3s
   → Server checks HitPay status
   → When completed, creates PaymentMethod and PaymentRecord
10. Frontend redirects to /success
```

## Testing

1. Use HitPay sandbox for PayNow testing
2. Use "Pay via HitPay checkout" link to simulate payment completion
3. For card testing, use Stripe test cards (4242 4242 4242 4242)

## Common Issues

### Custom Payment Method not showing
- Ensure CPM type is created and ENABLED in your Stripe Dashboard
- Add the beta flag when loading Stripe.js
- Check the CPM_TYPE_ID matches your Stripe Dashboard

### "embedded" type not working
- The `embedded` type requires special Stripe gating
- Contact Stripe for access to embedded custom payment methods

### PaymentIntent shows as "Incomplete"
- This is expected behavior for external payments
- Check PaymentIntent metadata for `external_payment_status: completed`
- Check Stripe Dashboard > Payments > Payment Records
