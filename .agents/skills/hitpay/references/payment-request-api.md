# Payment Request API Reference

## Create Payment Request

`POST /v1/payment-requests`

Creates a new payment request. This is the first step of the payment flow.

### Required Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `amount` | number | Payment amount (0.3 - 999,999,999.99) |
| `currency` | string | 3-letter currency code (SGD, USD, MYR, etc.) |

### Optional Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `payment_methods` | string[] | all | Array of allowed payment methods |
| `generate_qr` | boolean | false | Generate QR code for QR-based methods |
| `email` | string | - | Customer email address |
| `name` | string | - | Customer name |
| `phone` | string | - | Customer phone number |
| `purpose` | string | - | Payment description (max 255 chars) |
| `reference_number` | string | - | Your internal order ID (max 255 chars) |
| `redirect_url` | string | - | URL to redirect after payment |
| `webhook` | string | - | URL for payment confirmation webhook |
| `allow_repeated_payments` | boolean | false | Allow multiple payments on same request |
| `expiry_date` | string | - | Expiration (YYYY-MM-DD HH:mm:ss, SG timezone) |
| `expires_after` | string | - | Alternative: "5 minutes", "30 mins", "2 hours", "7 days" |
| `send_email` | boolean | false | Email receipt to customer |
| `send_sms` | boolean | true | SMS notification to customer |

### Payment Methods

#### Card
- `card` - Visa, Mastercard, American Express

#### QR-Based (use with `generate_qr: true`)
- `paynow_online` - PayNow (Singapore)
- `grabpay_direct` - GrabPay
- `shopee_pay` - ShopeePay
- `wechat` - WeChat Pay
- `alipay` - Alipay
- `fpx` - FPX (Malaysia)
- `promptpay` - PromptPay (Thailand)
- `truemoney` - TrueMoney (Thailand)
- `vietqr` - VietQR (Vietnam)
- `qris` - QRIS (Indonesia)
- `upi` - UPI (India)
- `gcash` - GCash (Philippines)

### Request Example

```typescript
const response = await fetch('https://api.sandbox.hit-pay.com/v1/payment-requests', {
  method: 'POST',
  headers: {
    'X-BUSINESS-API-KEY': process.env.HITPAY_API_KEY!,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    amount: 100.00,
    currency: 'SGD',
    payment_methods: ['card', 'paynow_online'],
    email: 'customer@example.com',
    name: 'John Smith',
    reference_number: 'ORDER-12345',
    redirect_url: 'https://yoursite.com/payment/complete',
    webhook: 'https://yoursite.com/api/webhooks/hitpay',
  }),
});

const data = await response.json();
```

### Response Example (Redirect Flow)

```json
{
  "id": "9ef68e2e-3569-4f69-9f68-04c7e4bb007c",
  "name": "John Smith",
  "email": "customer@example.com",
  "amount": "100.00",
  "currency": "sgd",
  "status": "pending",
  "reference_number": "ORDER-12345",
  "url": "https://securecheckout.hit-pay.com/payment-request/@business/9ef68e2e-...",
  "redirect_url": "https://yoursite.com/payment/complete",
  "webhook": "https://yoursite.com/api/webhooks/hitpay",
  "created_at": "2026-01-21T10:30:00",
  "updated_at": "2026-01-21T10:30:00"
}
```

### Response Example (QR Flow)

When `generate_qr: true` is set:

```json
{
  "id": "9ef68e2e-3569-4f69-9f68-04c7e4bb007c",
  "amount": "100.00",
  "currency": "sgd",
  "status": "pending",
  "qr_code_data": "00020101021126380009SG.PAYNOW...",
  "reference_number": "ORDER-12345",
  "created_at": "2026-01-21T10:30:00"
}
```

The `qr_code_data` contains the raw QR payload. Render it using a QR library:

```typescript
import QRCode from 'qrcode';

await QRCode.toCanvas(canvasElement, data.qr_code_data, { width: 256 });
```

---

## Get Payment Request Status

`GET /v1/payment-requests/{id}`

Retrieves the status and details of a payment request.

### Request Example

```typescript
const response = await fetch(
  `https://api.sandbox.hit-pay.com/v1/payment-requests/${paymentRequestId}`,
  {
    headers: {
      'X-BUSINESS-API-KEY': process.env.HITPAY_API_KEY!,
    },
  }
);

const data = await response.json();
```

### Response Example

```json
{
  "id": "9ef68e2e-3569-4f69-9f68-04c7e4bb007c",
  "name": "John Smith",
  "email": "customer@example.com",
  "amount": "100.00",
  "currency": "sgd",
  "status": "completed",
  "reference_number": "ORDER-12345",
  "payment_methods": ["card"],
  "payments": [
    {
      "id": "abc123",
      "amount": "100.00",
      "currency": "sgd",
      "status": "succeeded",
      "payment_type": "card",
      "created_at": "2026-01-21T10:35:00"
    }
  ],
  "created_at": "2026-01-21T10:30:00",
  "updated_at": "2026-01-21T10:35:00"
}
```

### Payment Request Statuses

| Status | Description |
|--------|-------------|
| `pending` | Awaiting payment |
| `completed` | Payment successful |
| `failed` | Payment failed |
| `expired` | Payment request expired |
| `canceled` | Payment request canceled |

---

## Delete Payment Request

`DELETE /v1/payment-requests/{id}`

Cancels a pending payment request.

### Request Example

```typescript
const response = await fetch(
  `https://api.sandbox.hit-pay.com/v1/payment-requests/${paymentRequestId}`,
  {
    method: 'DELETE',
    headers: {
      'X-BUSINESS-API-KEY': process.env.HITPAY_API_KEY!,
    },
  }
);
```

### Response

Returns `204 No Content` on success.

---

## Polling for Payment Status

For QR payments, you may want to poll for completion:

```typescript
async function pollPaymentStatus(
  paymentRequestId: string,
  maxAttempts = 60,
  intervalMs = 2000
): Promise<'completed' | 'failed' | 'timeout'> {
  for (let i = 0; i < maxAttempts; i++) {
    const response = await fetch(
      `https://api.sandbox.hit-pay.com/v1/payment-requests/${paymentRequestId}`,
      {
        headers: {
          'X-BUSINESS-API-KEY': process.env.HITPAY_API_KEY!,
        },
      }
    );

    const data = await response.json();

    if (data.status === 'completed') return 'completed';
    if (data.status === 'failed' || data.status === 'expired') return 'failed';

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return 'timeout';
}
```

**Note:** Always use webhooks as the primary confirmation method. Polling is a fallback for UI updates.
