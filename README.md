# Stripe Custom Payment Methods + HitPay PayNow Demo

A reference implementation showing how to integrate **HitPay PayNow** as a **Stripe Custom Payment Method** within Stripe's Payment Element.

This demo allows customers to pay via PayNow QR code while maintaining a unified checkout experience through Stripe Elements.

## Features

- **Unified Checkout**: PayNow appears alongside card payments in Stripe's Payment Element
- **QR Code Payments**: Generate PayNow QR codes for customers to scan with their banking app
- **Dual Confirmation**: Polling for immediate feedback + webhooks for reliability
- **Payment Records**: External payments are recorded in Stripe via the Payment Records API
- **Production-Ready Patterns**: Idempotency, error handling, and graceful degradation

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         Customer Browser                         │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              Stripe Payment Element                       │    │
│  │  ┌──────────┐  ┌──────────┐                              │    │
│  │  │  PayNow  │  │   Card   │  ← User selects payment      │    │
│  │  └────┬─────┘  └──────────┘    method                    │    │
│  └───────┼──────────────────────────────────────────────────┘    │
│          │                                                        │
│          ▼                                                        │
│  ┌───────────────┐     ┌─────────────────────────────────┐       │
│  │   QR Code     │     │  Polls /api/payment/check-status │       │
│  │   Display     │────▶│  every 3 seconds                 │       │
│  └───────────────┘     └─────────────────────────────────┘       │
└──────────────────────────────────────────────────────────────────┘
           │                           │
           │ Scan & Pay                │ Check Status
           ▼                           ▼
┌──────────────────┐         ┌──────────────────────────────────────┐
│   HitPay API     │         │           Your Server                 │
│   (PayNow)       │────────▶│  ┌────────────────────────────────┐  │
│                  │ Webhook │  │ /api/payment/check-status      │  │
│                  │         │  │ /api/hitpay/webhook            │  │
└──────────────────┘         │  └────────────────────────────────┘  │
                             │               │                       │
                             │               ▼                       │
                             │  ┌────────────────────────────────┐  │
                             │  │ Stripe Payment Records API     │  │
                             │  │ - Create PaymentMethod         │  │
                             │  │ - Record Payment               │  │
                             │  └────────────────────────────────┘  │
                             └──────────────────────────────────────┘
```

## Prerequisites

- **Node.js 18+**
- **Stripe Account** with Custom Payment Methods enabled (contact Stripe)
- **HitPay Account** with API access

## Quick Start

### 1. Clone and Install

```bash
git clone <repository-url>
cd stripe-cpm-demo-standalone
npm install
```

### 2. Configure Environment Variables

```bash
cp .env.local.example .env.local
```

Edit `.env.local` with your credentials (see [Configuration](#configuration) below).

### 3. Create Custom Payment Method Type in Stripe

1. Go to [Stripe Dashboard](https://dashboard.stripe.com) → Settings → Payment Methods
2. Click "Create custom payment method type"
3. Configure:
   - **Name**: PayNow
   - **Type**: Static (or Embedded if approved)
4. **Enable** the payment method type
5. Copy the ID (starts with `cpmt_`) to your `.env.local`

### 4. Configure HitPay (Optional: Webhooks)

1. Go to [HitPay Dashboard](https://dashboard.hit-pay.com) → Settings → API Keys
2. Copy your API key to `.env.local`
3. For webhooks, go to Settings → Webhooks
4. Add webhook URL: `https://your-domain.com/api/hitpay/webhook`
5. Copy the Salt to `.env.local`

### 5. Run the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Configuration

### Environment Variables

Keys are scoped per environment (`sandbox`, `staging`, `production`). The active environment is selected by `NEXT_PUBLIC_HITPAY_ENV`.

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_HITPAY_ENV` | No | `sandbox` (default), `staging`, or `production` |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_SANDBOX` | Yes | Stripe publishable key for sandbox |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_STAGING` | For staging | Stripe publishable key for staging |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_PRODUCTION` | For production | Stripe publishable key for production |
| `STRIPE_SECRET_KEY_SANDBOX` | Yes | Stripe secret key for sandbox |
| `STRIPE_SECRET_KEY_STAGING` | For staging | Stripe secret key for staging |
| `STRIPE_SECRET_KEY_PRODUCTION` | For production | Stripe secret key for production |
| `HITPAY_API_KEY_SANDBOX` | Yes | HitPay API key for sandbox |
| `HITPAY_API_KEY_STAGING` | For staging | HitPay API key for staging |
| `HITPAY_API_KEY_PRODUCTION` | For production | HitPay API key for production |
| `HITPAY_SALT_SANDBOX` | For webhooks | HitPay webhook salt for sandbox |
| `HITPAY_SALT_STAGING` | For webhooks | HitPay webhook salt for staging |
| `HITPAY_SALT_PRODUCTION` | For webhooks | HitPay webhook salt for production |
| `STRIPE_WEBHOOK_SECRET` | For auto-charge | Stripe webhook signing secret |
| `NEXT_PUBLIC_SITE_URL` | For webhooks | Your public URL for webhook callbacks |

**Note:** CPM Type IDs are configured in `/config/payment-methods.ts`, not via environment variables.

### Example `.env.local`

```bash
# Active environment: sandbox | staging | production
NEXT_PUBLIC_HITPAY_ENV=sandbox

# Stripe Keys (per environment)
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_SANDBOX=pk_test_51ABC...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_PRODUCTION=pk_live_51ABC...
STRIPE_SECRET_KEY_SANDBOX=sk_test_51ABC...
STRIPE_SECRET_KEY_PRODUCTION=sk_live_51ABC...

# HitPay Keys (per environment)
HITPAY_API_KEY_SANDBOX=your-sandbox-api-key
HITPAY_API_KEY_PRODUCTION=your-production-api-key
HITPAY_SALT_SANDBOX=your-sandbox-salt
HITPAY_SALT_PRODUCTION=your-production-salt

# Webhook configuration (for production)
STRIPE_WEBHOOK_SECRET=whsec_xxx
NEXT_PUBLIC_SITE_URL=https://your-domain.com
```

## Project Structure

```
├── app/
│   ├── api/
│   │   ├── create-payment-intent/route.ts  # Creates Stripe PaymentIntent
│   │   ├── hitpay/
│   │   │   ├── create/route.ts             # Creates HitPay payment + QR
│   │   │   └── webhook/route.ts            # Handles HitPay webhooks
│   │   └── payment/
│   │       └── check-status/route.ts       # Polls HitPay, records in Stripe
│   ├── checkout/page.tsx                   # Checkout page with Elements
│   └── success/page.tsx                    # Payment success page
├── components/
│   └── CheckoutForm.tsx                    # Payment form + QR code display
├── lib/
│   ├── stripe.ts                           # Server-side Stripe client
│   ├── stripe-client.ts                    # Client-side Stripe.js loader
│   └── hitpay.ts                           # HitPay API client
└── CLAUDE.md                               # AI assistant context
```

## API Reference

### POST /api/create-payment-intent

Creates a Stripe PaymentIntent for the checkout session.

**Request:**
```json
{
  "amount": 1999,
  "currency": "sgd"
}
```

**Response:**
```json
{
  "clientSecret": "pi_xxx_secret_yyy",
  "paymentIntentId": "pi_xxx"
}
```

### POST /api/hitpay/create

Creates a HitPay payment request with QR code.

**Request:**
```json
{
  "amount": 1999,
  "currency": "sgd",
  "referenceNumber": "pi_xxx"
}
```

**Response:**
```json
{
  "paymentRequestId": "abc123",
  "qrCode": "00020101021126...",
  "qrCodeExpiry": "2024-01-01T12:00:00Z",
  "status": "pending",
  "checkoutUrl": "https://hit-pay.com/..."
}
```

### POST /api/payment/check-status

Checks payment status and records completed payments in Stripe.

**Request:**
```json
{
  "paymentIntentId": "pi_xxx",
  "hitpayPaymentRequestId": "abc123",
  "customPaymentMethodTypeId": "cpmt_xxx"
}
```

**Response (completed):**
```json
{
  "status": "completed",
  "hitpay": { "id": "abc123", "status": "completed", ... },
  "stripe": { "paymentRecordId": "prec_xxx", "paymentIntentId": "pi_xxx" },
  "message": "Payment confirmed and recorded successfully"
}
```

### POST /api/hitpay/webhook

Receives HitPay webhook notifications (backup to polling).

HitPay sends webhooks when payment status changes. The endpoint:
1. Verifies HMAC-SHA256 signature
2. Checks if payment already recorded (idempotency)
3. Records payment in Stripe if completed
4. Returns 200 OK to acknowledge

## Payment Flow

### 1. Checkout Page Load
- Creates PaymentIntent on your Stripe account
- Loads Stripe Elements with Custom Payment Method configured

### 2. User Selects PayNow
- Payment Element shows PayNow as an option
- Component detects selection and calls `/api/hitpay/create`
- QR code is displayed below the Payment Element

### 3. User Scans QR Code
- Customer scans with banking app (DBS, OCBC, etc.)
- Completes payment via PayNow

### 4. Payment Confirmation (Dual Approach)

**Polling (Immediate):**
- Frontend polls `/api/payment/check-status` every 3 seconds
- On completion, redirects to success page

**Webhook (Reliable):**
- HitPay sends webhook to `/api/hitpay/webhook`
- Records payment even if browser is closed

### 5. Stripe Recording
- Creates PaymentMethod with custom type
- Reports payment via Payment Records API
- Updates PaymentIntent metadata

## Testing

### In Sandbox Mode

1. Add items to cart and go to checkout
2. Select "PayNow" in the Payment Element
3. Click "Pay via HitPay checkout (for testing)"
4. Complete the simulated payment
5. Wait for polling to detect completion (~3 seconds)

### Test Cards (for Card Payments)

| Card Number | Scenario |
|-------------|----------|
| 4242 4242 4242 4242 | Success |
| 4000 0000 0000 0002 | Declined |

## Troubleshooting

### PayNow option not appearing

1. **Check CPM Type ID**: Ensure the `id` in `/config/payment-methods.ts` matches your Stripe Dashboard
2. **Enable the CPM Type**: Go to Stripe Dashboard → Payment Methods → Enable your custom type
3. **Check Console**: Look for warnings about missing configuration
4. **Beta Flag**: Ensure Stripe.js is loaded with `custom_payment_methods_beta_1`

### QR Code not generating

1. **Check HitPay API Key**: Verify `HITPAY_API_KEY` is correct
2. **Check Console**: Look for API errors in browser console
3. **Sandbox Mode**: Ensure `NEXT_PUBLIC_HITPAY_ENV=sandbox` for testing

### Payment not recording in Stripe

1. **Check Stripe API Version**: Must use beta version for Payment Records
2. **Check CPM Type ID**: Must match between frontend and backend
3. **Check Logs**: Review server logs for Stripe API errors

### Webhook not receiving

1. **Public URL**: Webhook URL must be publicly accessible
2. **Correct Path**: URL should be `https://your-domain.com/api/hitpay/webhook`
3. **Salt Configuration**: `HITPAY_SALT` must match HitPay Dashboard

## Key Concepts

### Custom Payment Methods (CPM)

- CPM types are configured **client-side** via Elements, not via PaymentIntent
- Requires the `custom_payment_methods_beta_1` beta flag in Stripe.js
- External payments are recorded via the Payment Records API

### Payment Records API

- Records payments that happen outside of Stripe
- Creates `prec_*` objects (Payment Records)
- PaymentIntent remains "Incomplete" - this is expected

### Polling vs Webhooks

| Approach | Pros | Cons |
|----------|------|------|
| Polling | Immediate feedback, simple | Requires open browser |
| Webhook | Reliable, works if browser closes | Delayed, requires public URL |

**This demo uses both** for the best user experience and reliability.

## Security Considerations

- **API Keys**: Never expose secret keys in client-side code
- **Webhook Verification**: Always verify HMAC signatures
- **Idempotency**: Check for existing records before creating duplicates
- **Error Handling**: Never expose internal errors to clients

## License

MIT
