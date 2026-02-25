# Webhook Events Reference

## Overview

HitPay sends webhooks to notify your server about payment events. Always verify the signature before processing.

**Important:** Never trust redirect URLs alone. Always use webhooks to confirm payment status before fulfilling orders.

---

## Webhook Headers

| Header | Description |
|--------|-------------|
| `Hitpay-Signature` | HMAC-SHA256 hash of the JSON payload |
| `Hitpay-Event-Type` | `created` or `updated` |
| `Hitpay-Event-Object` | Object type: `charge`, `payment_request`, `payout`, etc. |
| `User-Agent` | `HitPay v2.0` |
| `Content-Type` | `application/json` |

---

## Event Types

### Payment Request Events

| Event | Description |
|-------|-------------|
| `payment_request.completed` | Payment was successful |
| `payment_request.failed` | Payment failed |

### Charge Events

| Event | Description |
|-------|-------------|
| `charge.created` | New charge created |
| `charge.updated` | Charge status updated |

### Payout Events

| Event | Description |
|-------|-------------|
| `payout.created` | New payout initiated |

### Transfer Events

| Event | Description |
|-------|-------------|
| `transfer.created` | Transfer created |
| `transfer.updated` | Transfer updated |
| `transfer.processing` | Transfer being processed |
| `transfer.scheduled` | Transfer scheduled |
| `transfer.paid` | Transfer completed |
| `transfer.failed` | Transfer failed |
| `transfer.canceled` | Transfer canceled |

### Order Events

| Event | Description |
|-------|-------------|
| `order.created` | Order created |
| `order.updated` | Order updated |

### Invoice Events

| Event | Description |
|-------|-------------|
| `invoice.created` | Invoice created |

---

## Signature Verification

### How It Works

1. HitPay sends the webhook with a `Hitpay-Signature` header
2. The signature is an HMAC-SHA256 hash of the request body
3. The secret key is your **salt** from the HitPay dashboard
4. Compare your computed signature with the header value

### Next.js Implementation

```typescript
// app/api/webhooks/hitpay/route.ts
import { NextResponse } from 'next/server';
import crypto from 'crypto';

export async function POST(request: Request) {
  const body = await request.text();
  const signature = request.headers.get('Hitpay-Signature');
  const eventType = request.headers.get('Hitpay-Event-Type');
  const eventObject = request.headers.get('Hitpay-Event-Object');

  // Verify signature
  const expectedSignature = crypto
    .createHmac('sha256', process.env.HITPAY_SALT!)
    .update(body)
    .digest('hex');

  if (signature !== expectedSignature) {
    console.error('Invalid webhook signature');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const payload = JSON.parse(body);

  // Handle different event types
  switch (`${eventObject}.${eventType}`) {
    case 'payment_request.completed':
      await handlePaymentCompleted(payload);
      break;
    case 'payment_request.failed':
      await handlePaymentFailed(payload);
      break;
    default:
      console.log(`Unhandled event: ${eventObject}.${eventType}`);
  }

  return NextResponse.json({ received: true });
}

async function handlePaymentCompleted(payload: any) {
  const { reference_number, amount, currency } = payload;

  // Mark order as paid in your database
  // await db.orders.update({ id: reference_number, status: 'paid' });

  console.log(`Payment completed: ${reference_number} - ${amount} ${currency}`);
}

async function handlePaymentFailed(payload: any) {
  const { reference_number } = payload;

  // Handle failed payment
  // await db.orders.update({ id: reference_number, status: 'failed' });

  console.log(`Payment failed: ${reference_number}`);
}
```

### Express.js Implementation

```typescript
// routes/webhooks.ts
import express from 'express';
import crypto from 'crypto';

const router = express.Router();

// Use raw body parser for webhooks
router.post(
  '/hitpay',
  express.raw({ type: 'application/json' }),
  (req, res) => {
    const body = req.body.toString();
    const signature = req.headers['hitpay-signature'] as string;

    const expectedSignature = crypto
      .createHmac('sha256', process.env.HITPAY_SALT!)
      .update(body)
      .digest('hex');

    if (signature !== expectedSignature) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const payload = JSON.parse(body);
    const eventObject = req.headers['hitpay-event-object'];
    const eventType = req.headers['hitpay-event-type'];

    // Process the webhook
    console.log(`Received: ${eventObject}.${eventType}`, payload);

    res.json({ received: true });
  }
);

export default router;
```

### Utility Function

```typescript
// lib/hitpay.ts
import crypto from 'crypto';

export function verifyHitPaySignature(
  body: string,
  signature: string | null,
  salt: string
): boolean {
  if (!signature) return false;

  const expectedSignature = crypto
    .createHmac('sha256', salt)
    .update(body)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}
```

---

## Webhook Payload Examples

### Payment Request Completed

```json
{
  "id": "9ef68e2e-3569-4f69-9f68-04c7e4bb007c",
  "amount": "100.00",
  "currency": "sgd",
  "status": "completed",
  "reference_number": "ORDER-12345",
  "email": "customer@example.com",
  "name": "John Smith",
  "payment_type": "card",
  "payments": [
    {
      "id": "pay_abc123",
      "amount": "100.00",
      "currency": "sgd",
      "status": "succeeded"
    }
  ],
  "created_at": "2026-01-21T10:30:00",
  "updated_at": "2026-01-21T10:35:00"
}
```

### Payment Request Failed

```json
{
  "id": "9ef68e2e-3569-4f69-9f68-04c7e4bb007c",
  "amount": "100.00",
  "currency": "sgd",
  "status": "failed",
  "reference_number": "ORDER-12345",
  "failure_reason": "card_declined",
  "created_at": "2026-01-21T10:30:00",
  "updated_at": "2026-01-21T10:35:00"
}
```

---

## Setting Up Webhooks

### Via Dashboard

1. Go to HitPay Dashboard → Settings → Developers → Webhook Endpoints
2. Add your webhook URL (e.g., `https://yoursite.com/api/webhooks/hitpay`)
3. Select the events you want to receive
4. Copy the **salt** value for signature verification

### Via API (per request)

Include the `webhook` parameter when creating a payment request:

```typescript
{
  amount: 100,
  currency: 'SGD',
  webhook: 'https://yoursite.com/api/webhooks/hitpay',
  // ... other params
}
```

---

## Best Practices

1. **Always verify signatures** — Never process webhooks without verification
2. **Use HTTPS** — Webhook URLs must be secure
3. **Return 200 quickly** — Process webhooks asynchronously if needed
4. **Handle duplicates** — Use idempotency keys or check if already processed
5. **Log everything** — Keep records for debugging and reconciliation
6. **Retry handling** — HitPay will retry failed webhooks; ensure idempotent processing

### Idempotent Processing Example

```typescript
async function handlePaymentCompleted(payload: any) {
  const { id, reference_number } = payload;

  // Check if already processed
  const existing = await db.webhookLogs.findUnique({ where: { paymentId: id } });
  if (existing) {
    console.log(`Webhook already processed: ${id}`);
    return;
  }

  // Process the payment
  await db.orders.update({
    where: { id: reference_number },
    data: { status: 'paid', paidAt: new Date() },
  });

  // Log the webhook
  await db.webhookLogs.create({
    data: { paymentId: id, processedAt: new Date() },
  });
}
```
