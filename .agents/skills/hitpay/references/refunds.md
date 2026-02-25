# Refunds API Reference

## Overview

HitPay supports full and partial refunds for completed payments. Refunds are processed back to the original payment method.

---

## Create Refund

`POST /v1/payment-requests/{id}/refund`

Refunds a completed payment request.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `amount` | number | No | Amount to refund. If omitted, full refund is processed |

### Request Example - Full Refund

```typescript
// app/api/payments/[id]/refund/route.ts
import { NextResponse } from 'next/server';

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const response = await fetch(
    `https://api.sandbox.hit-pay.com/v1/payment-requests/${params.id}/refund`,
    {
      method: 'POST',
      headers: {
        'X-BUSINESS-API-KEY': process.env.HITPAY_API_KEY!,
        'Content-Type': 'application/json',
      },
    }
  );

  const data = await response.json();
  return NextResponse.json(data);
}
```

### Request Example - Partial Refund

```typescript
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const { amount } = await request.json();

  const response = await fetch(
    `https://api.sandbox.hit-pay.com/v1/payment-requests/${params.id}/refund`,
    {
      method: 'POST',
      headers: {
        'X-BUSINESS-API-KEY': process.env.HITPAY_API_KEY!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ amount }),
    }
  );

  const data = await response.json();
  return NextResponse.json(data);
}
```

### Response Example

```json
{
  "id": "9ef68e2e-3569-4f69-9f68-04c7e4bb007c",
  "amount": "100.00",
  "currency": "sgd",
  "status": "refunded",
  "reference_number": "ORDER-12345",
  "refunds": [
    {
      "id": "ref_abc123",
      "amount": "100.00",
      "currency": "sgd",
      "status": "succeeded",
      "created_at": "2026-01-21T12:00:00"
    }
  ],
  "created_at": "2026-01-21T10:30:00",
  "updated_at": "2026-01-21T12:00:00"
}
```

---

## Refund Service Example

```typescript
// lib/hitpay-refund.ts

interface RefundResult {
  success: boolean;
  refundId?: string;
  error?: string;
}

export async function createRefund(
  paymentRequestId: string,
  amount?: number
): Promise<RefundResult> {
  try {
    const body: Record<string, any> = {};
    if (amount !== undefined) {
      body.amount = amount;
    }

    const response = await fetch(
      `https://api.sandbox.hit-pay.com/v1/payment-requests/${paymentRequestId}/refund`,
      {
        method: 'POST',
        headers: {
          'X-BUSINESS-API-KEY': process.env.HITPAY_API_KEY!,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      return {
        success: false,
        error: error.message || 'Refund failed',
      };
    }

    const data = await response.json();
    const refund = data.refunds?.[data.refunds.length - 1];

    return {
      success: true,
      refundId: refund?.id,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function createFullRefund(paymentRequestId: string): Promise<RefundResult> {
  return createRefund(paymentRequestId);
}

export async function createPartialRefund(
  paymentRequestId: string,
  amount: number
): Promise<RefundResult> {
  return createRefund(paymentRequestId, amount);
}
```

---

## Next.js API Routes

### Full Refund Endpoint

```typescript
// app/api/orders/[orderId]/refund/route.ts
import { NextResponse } from 'next/server';
import { createFullRefund } from '@/lib/hitpay-refund';

export async function POST(
  request: Request,
  { params }: { params: { orderId: string } }
) {
  // Get the payment request ID from your database
  const order = await db.orders.findUnique({
    where: { id: params.orderId },
  });

  if (!order || !order.paymentRequestId) {
    return NextResponse.json(
      { error: 'Order not found' },
      { status: 404 }
    );
  }

  if (order.status === 'refunded') {
    return NextResponse.json(
      { error: 'Order already refunded' },
      { status: 400 }
    );
  }

  const result = await createFullRefund(order.paymentRequestId);

  if (!result.success) {
    return NextResponse.json(
      { error: result.error },
      { status: 400 }
    );
  }

  // Update order status
  await db.orders.update({
    where: { id: params.orderId },
    data: { status: 'refunded', refundedAt: new Date() },
  });

  return NextResponse.json({ success: true, refundId: result.refundId });
}
```

### Partial Refund Endpoint

```typescript
// app/api/orders/[orderId]/partial-refund/route.ts
import { NextResponse } from 'next/server';
import { createPartialRefund } from '@/lib/hitpay-refund';

export async function POST(
  request: Request,
  { params }: { params: { orderId: string } }
) {
  const { amount } = await request.json();

  if (!amount || amount <= 0) {
    return NextResponse.json(
      { error: 'Invalid refund amount' },
      { status: 400 }
    );
  }

  const order = await db.orders.findUnique({
    where: { id: params.orderId },
  });

  if (!order || !order.paymentRequestId) {
    return NextResponse.json(
      { error: 'Order not found' },
      { status: 404 }
    );
  }

  // Check refund doesn't exceed original amount
  const totalRefunded = order.refundedAmount || 0;
  if (totalRefunded + amount > order.amount) {
    return NextResponse.json(
      { error: 'Refund amount exceeds remaining balance' },
      { status: 400 }
    );
  }

  const result = await createPartialRefund(order.paymentRequestId, amount);

  if (!result.success) {
    return NextResponse.json(
      { error: result.error },
      { status: 400 }
    );
  }

  // Update order with partial refund
  await db.orders.update({
    where: { id: params.orderId },
    data: {
      refundedAmount: totalRefunded + amount,
      status: totalRefunded + amount >= order.amount ? 'refunded' : 'partially_refunded',
    },
  });

  return NextResponse.json({ success: true, refundId: result.refundId });
}
```

---

## Admin UI Component

```typescript
// components/RefundButton.tsx
'use client';

import { useState } from 'react';

interface RefundButtonProps {
  orderId: string;
  maxAmount: number;
}

export function RefundButton({ orderId, maxAmount }: RefundButtonProps) {
  const [loading, setLoading] = useState(false);
  const [amount, setAmount] = useState<string>('');
  const [mode, setMode] = useState<'full' | 'partial'>('full');

  const handleRefund = async () => {
    if (!confirm('Are you sure you want to process this refund?')) return;

    setLoading(true);

    try {
      const endpoint = mode === 'full'
        ? `/api/orders/${orderId}/refund`
        : `/api/orders/${orderId}/partial-refund`;

      const body = mode === 'partial' ? { amount: parseFloat(amount) } : {};

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (!response.ok) {
        alert(`Refund failed: ${data.error}`);
        return;
      }

      alert('Refund processed successfully');
      window.location.reload();
    } catch (error) {
      alert('Refund failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <select value={mode} onChange={(e) => setMode(e.target.value as 'full' | 'partial')}>
        <option value="full">Full Refund</option>
        <option value="partial">Partial Refund</option>
      </select>

      {mode === 'partial' && (
        <input
          type="number"
          placeholder="Amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          max={maxAmount}
          step="0.01"
        />
      )}

      <button onClick={handleRefund} disabled={loading}>
        {loading ? 'Processing...' : 'Process Refund'}
      </button>
    </div>
  );
}
```

---

## Important Notes

1. **Refunds are processed to the original payment method** — Card refunds go back to the card, PayNow refunds go back to the bank account, etc.

2. **Processing time varies by payment method:**
   - Cards: 5-10 business days
   - PayNow/Bank transfers: 1-3 business days
   - E-wallets: Usually instant

3. **Partial refunds** — You can issue multiple partial refunds up to the original payment amount.

4. **Refund limits** — Cannot refund more than the original payment amount.

5. **Idempotency** — Always check if a refund was already processed before initiating a new one.
