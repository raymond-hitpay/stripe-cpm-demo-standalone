#!/bin/bash
set -e

# HitPay Webhook Signature Verification
# This script outputs code samples for verifying webhook signatures

cat << 'TYPESCRIPT_NEXTJS'
// ============================================
// Next.js App Router - Webhook Handler
// ============================================
// File: app/api/webhooks/hitpay/route.ts

import { NextResponse } from 'next/server';
import crypto from 'crypto';

export async function POST(request: Request) {
  const body = await request.text();
  const signature = request.headers.get('Hitpay-Signature');
  const eventType = request.headers.get('Hitpay-Event-Type');
  const eventObject = request.headers.get('Hitpay-Event-Object');

  // Verify signature using HMAC-SHA256
  const expectedSignature = crypto
    .createHmac('sha256', process.env.HITPAY_SALT!)
    .update(body)
    .digest('hex');

  if (signature !== expectedSignature) {
    console.error('Invalid webhook signature');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const payload = JSON.parse(body);

  // Handle payment events
  if (eventObject === 'payment_request') {
    if (payload.status === 'completed') {
      // Payment successful - fulfill order
      await handlePaymentSuccess(payload);
    } else if (payload.status === 'failed') {
      // Payment failed
      await handlePaymentFailure(payload);
    }
  }

  return NextResponse.json({ received: true });
}

async function handlePaymentSuccess(payload: any) {
  const { reference_number, amount, currency } = payload;
  console.log(`Payment completed: ${reference_number} - ${amount} ${currency}`);
  // Update your database here
}

async function handlePaymentFailure(payload: any) {
  const { reference_number } = payload;
  console.log(`Payment failed: ${reference_number}`);
  // Handle failure in your database
}
TYPESCRIPT_NEXTJS

echo ""
echo "---"
echo ""

cat << 'TYPESCRIPT_EXPRESS'
// ============================================
// Express.js - Webhook Handler
// ============================================
// File: routes/webhooks.ts

import express, { Request, Response } from 'express';
import crypto from 'crypto';

const router = express.Router();

// Important: Use raw body parser for webhook routes
router.post(
  '/hitpay',
  express.raw({ type: 'application/json' }),
  (req: Request, res: Response) => {
    const body = req.body.toString();
    const signature = req.headers['hitpay-signature'] as string;

    // Verify signature
    const expectedSignature = crypto
      .createHmac('sha256', process.env.HITPAY_SALT!)
      .update(body)
      .digest('hex');

    // Use timing-safe comparison to prevent timing attacks
    const isValid = crypto.timingSafeEqual(
      Buffer.from(signature || ''),
      Buffer.from(expectedSignature)
    );

    if (!isValid) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const payload = JSON.parse(body);
    const eventObject = req.headers['hitpay-event-object'];

    if (eventObject === 'payment_request' && payload.status === 'completed') {
      // Process successful payment
      console.log('Payment completed:', payload.reference_number);
    }

    res.json({ received: true });
  }
);

export default router;
TYPESCRIPT_EXPRESS

echo ""
echo "---"
echo ""

cat << 'TYPESCRIPT_UTILITY'
// ============================================
// Reusable Utility Function
// ============================================
// File: lib/hitpay.ts

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

  // Use timing-safe comparison
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  } catch {
    return false;
  }
}

// Usage in Next.js:
// import { verifyHitPaySignature } from '@/lib/hitpay';
//
// const body = await request.text();
// const signature = request.headers.get('Hitpay-Signature');
//
// if (!verifyHitPaySignature(body, signature, process.env.HITPAY_SALT!)) {
//   return NextResponse.json({ error: 'Invalid' }, { status: 401 });
// }
TYPESCRIPT_UTILITY

echo ""
echo "---"
echo ""

cat << 'ENV_EXAMPLE'
# ============================================
# Environment Variables
# ============================================
# File: .env.local (Next.js) or .env (Node.js)

# Get these from HitPay Dashboard > Settings > Payment Gateway > API Keys
HITPAY_API_KEY=your_api_key_here

# Get this from HitPay Dashboard > Settings > Developers > Webhook Endpoints
HITPAY_SALT=your_webhook_salt_here

# Your app URL (used for redirect_url and webhook)
NEXT_PUBLIC_APP_URL=http://localhost:3000
ENV_EXAMPLE

echo ""
echo "Webhook verification code samples generated."
echo "Copy the appropriate code for your framework."
