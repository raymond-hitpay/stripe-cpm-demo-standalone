/**
 * Tests for charge-invoice (HitPay auto-charge) and related webhook flows.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — vi.mock factories are hoisted, so use vi.fn() inline
// ---------------------------------------------------------------------------

vi.mock('@/lib/stripe', () => ({
  stripe: {
    invoices: {
      retrieve: vi.fn(),
      update: vi.fn(),
      pay: vi.fn(),
      attachPayment: vi.fn(),
    },
    customers: {
      retrieve: vi.fn(),
    },
    subscriptions: {
      retrieve: vi.fn(),
      update: vi.fn(),
    },
    paymentMethods: {
      create: vi.fn(),
      attach: vi.fn(),
    },
    paymentRecords: {
      reportPayment: vi.fn(),
    },
    webhooks: {
      constructEvent: vi.fn(),
    },
  },
}));

vi.mock('@/lib/hitpay', () => ({
  chargeRecurringBilling: vi.fn(),
  verifyHitPayWebhook: vi.fn(),
  verifyHitPayJsonWebhook: vi.fn(),
  verifyHitPayHeaderSignature: vi.fn(),
  getHitPayPaymentStatus: vi.fn(),
}));

vi.mock('@/config/payment-methods', () => ({
  CUSTOM_PAYMENT_METHODS: [
    {
      id: 'cpmt_test',
      hitpayMethod: 'shopee_pay',
      hitpayRecurringMethod: 'shopee_recurring',
      displayName: 'ShopeePay',
      chargeAutomatically: true,
    },
  ],
  getOneTimeCpms: () => [],
}));

import { stripe } from '@/lib/stripe';
import { chargeRecurringBilling } from '@/lib/hitpay';
import { chargeInvoiceInternal } from '@/lib/charge-invoice';

const mockStripe = stripe as any;
const mockChargeRecurringBilling = chargeRecurringBilling as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: 'in_test',
    status: 'open',
    amount_due: 2990,
    currency: 'sgd',
    customer: {
      id: 'cus_test',
      metadata: {
        hitpay_recurring_billing_id: 'rb_test',
        hitpay_cpm_type_id: 'cpmt_test',
      },
    },
    subscription: { id: 'sub_test', status: 'active' },
    default_payment_method: {
      id: 'pm_existing',
      metadata: {
        hitpay_recurring_billing_id: 'rb_test',
        hitpay_payment_method: 'shopee_recurring',
      },
    },
    metadata: {},
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockStripe.invoices.attachPayment.mockResolvedValue({});
  mockStripe.invoices.update.mockResolvedValue({});
  mockStripe.invoices.pay.mockResolvedValue({});
  mockStripe.paymentMethods.create.mockResolvedValue({ id: 'pm_test' });
  mockStripe.paymentMethods.attach.mockResolvedValue({});
  mockStripe.subscriptions.update.mockResolvedValue({});
  mockStripe.paymentRecords.reportPayment.mockResolvedValue({ id: 'prec_test' });
  mockChargeRecurringBilling.mockResolvedValue({
    payment_id: 'hp_pay_123',
    status: 'succeeded',
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('chargeInvoiceInternal', () => {
  it('1. Happy path: attachPayment succeeds, invoice paid', async () => {
    const invoice = makeInvoice();
    mockStripe.invoices.retrieve
      .mockResolvedValueOnce(invoice) // initial retrieve (chargeInvoiceInternal)
      .mockResolvedValueOnce(invoice) // markInvoicePaidWithFallback BEFORE diagnostic
      .mockResolvedValueOnce({ ...invoice, status: 'paid' }) // markInvoicePaidWithFallback AFTER verify
      .mockResolvedValueOnce({ ...invoice, status: 'paid', subscription: { id: 'sub_test', status: 'active' } }); // final verify

    const result = await chargeInvoiceInternal('in_test', 'api');

    expect(result.success).toBe(true);
    expect(result.invoiceStatus).toBe('paid');
    expect(result.hitpayPaymentId).toBe('hp_pay_123');
    expect(result.paymentRecordId).toBe('prec_test');
  });

  it('2. attachPayment fails, fallback to paid_out_of_band succeeds', async () => {
    const invoice = makeInvoice();
    mockStripe.invoices.retrieve
      .mockResolvedValueOnce(invoice) // initial
      .mockResolvedValueOnce(invoice) // markInvoicePaidWithFallback BEFORE diagnostic
      .mockResolvedValueOnce({ ...invoice, status: 'open' }) // markInvoicePaidWithFallback AFTER (still open)
      .mockResolvedValueOnce({ ...invoice, status: 'paid', subscription: { id: 'sub_test', status: 'active' } }); // final verify

    mockStripe.invoices.attachPayment.mockRejectedValueOnce(new Error('beta API error'));
    mockStripe.invoices.pay.mockResolvedValueOnce({});

    const result = await chargeInvoiceInternal('in_test', 'api');

    expect(result.success).toBe(true);
    expect(result.invoiceStatus).toBe('paid');
    expect(mockStripe.invoices.pay).toHaveBeenCalledWith('in_test', { paid_out_of_band: true });
  });

  it('3. Both attachPayment and paid_out_of_band fail', async () => {
    const invoice = makeInvoice();
    mockStripe.invoices.retrieve
      .mockResolvedValueOnce(invoice) // initial
      .mockResolvedValueOnce(invoice) // markInvoicePaidWithFallback BEFORE diagnostic
      .mockResolvedValueOnce({ ...invoice, status: 'open' }) // markInvoicePaidWithFallback AFTER (still open)
      .mockResolvedValueOnce({ ...invoice, status: 'open', subscription: { id: 'sub_test', status: 'incomplete' } });

    mockStripe.invoices.attachPayment.mockRejectedValueOnce(new Error('beta API error'));
    mockStripe.invoices.pay.mockRejectedValueOnce(new Error('pay failed too'));

    const result = await chargeInvoiceInternal('in_test', 'api');

    expect(result.success).toBe(true);
    expect(result.invoiceStatus).toBe('open');
    expect(result.message).toContain('could not be marked as paid');
  });

  it('4. Idempotency: invoice already paid', async () => {
    mockStripe.invoices.retrieve.mockResolvedValueOnce(makeInvoice({ status: 'paid' }));

    const result = await chargeInvoiceInternal('in_test', 'api');

    expect(result.success).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.message).toBe('Invoice was already paid');
    expect(mockChargeRecurringBilling).not.toHaveBeenCalled();
  });

  it('5. Idempotency: hitpay_payment_id metadata exists', async () => {
    mockStripe.invoices.retrieve.mockResolvedValueOnce(
      makeInvoice({ metadata: { hitpay_payment_id: 'hp_existing' } })
    );

    const result = await chargeInvoiceInternal('in_test', 'api');

    expect(result.success).toBe(true);
    expect(result.skipped).toBe(true);
    expect(mockChargeRecurringBilling).not.toHaveBeenCalled();
  });

  it('6. Pending charge: HitPay returns pending, invoice still marked paid', async () => {
    mockChargeRecurringBilling.mockResolvedValueOnce({
      payment_id: 'hp_pending',
      status: 'pending',
    });

    const invoice = makeInvoice();
    mockStripe.invoices.retrieve
      .mockResolvedValueOnce(invoice) // initial
      .mockResolvedValueOnce(invoice) // markInvoicePaidWithFallback BEFORE diagnostic
      .mockResolvedValueOnce({ ...invoice, status: 'paid' }) // markInvoicePaidWithFallback AFTER
      .mockResolvedValueOnce({ ...invoice, status: 'paid', subscription: { id: 'sub_test', status: 'active' } });

    const result = await chargeInvoiceInternal('in_test', 'api');

    expect(result.success).toBe(true);
    expect(result.pending).toBe(true);
    expect(result.invoiceStatus).toBe('paid');
  });
});

describe('Stripe webhook (invoice.payment_attempt_required)', () => {
  it('8. Skips first invoice (subscription_create)', async () => {
    const { POST } = await import('@/app/api/stripe/webhook/route');

    const event = {
      type: 'invoice.payment_attempt_required',
      id: 'evt_test',
      data: {
        object: {
          id: 'in_first',
          status: 'open',
          amount_due: 2990,
          billing_reason: 'subscription_create',
          customer: 'cus_test',
        },
      },
    };

    mockStripe.webhooks.constructEvent.mockReturnValueOnce(event);

    const origSecret = process.env.STRIPE_WEBHOOK_SECRET;
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

    const request = new Request('http://localhost/api/stripe/webhook', {
      method: 'POST',
      body: JSON.stringify(event),
      headers: { 'stripe-signature': 'sig_test' },
    });

    const response = await POST(request as any);
    const json = await response.json();

    expect(json.message).toContain('First invoice');

    process.env.STRIPE_WEBHOOK_SECRET = origSecret;
  });

  it('9. Charges renewal invoice via chargeInvoiceInternal', async () => {
    const { POST } = await import('@/app/api/stripe/webhook/route');

    const event = {
      type: 'invoice.payment_attempt_required',
      id: 'evt_renewal',
      data: {
        object: {
          id: 'in_renewal',
          status: 'open',
          amount_due: 2990,
          billing_reason: 'subscription_cycle',
          customer: 'cus_test',
        },
      },
    };

    mockStripe.webhooks.constructEvent.mockReturnValueOnce(event);
    mockStripe.customers.retrieve.mockResolvedValueOnce({
      id: 'cus_test',
      deleted: false,
      metadata: { hitpay_recurring_billing_id: 'rb_test', hitpay_cpm_type_id: 'cpmt_test' },
    });

    const invoice = makeInvoice({ id: 'in_renewal' });
    mockStripe.invoices.retrieve
      .mockResolvedValueOnce(invoice) // initial
      .mockResolvedValueOnce(invoice) // markInvoicePaidWithFallback BEFORE diagnostic
      .mockResolvedValueOnce({ ...invoice, status: 'paid' }) // markInvoicePaidWithFallback AFTER
      .mockResolvedValueOnce({ ...invoice, status: 'paid', subscription: { id: 'sub_test', status: 'active' } });

    const origSecret = process.env.STRIPE_WEBHOOK_SECRET;
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

    const request = new Request('http://localhost/api/stripe/webhook', {
      method: 'POST',
      body: JSON.stringify(event),
      headers: { 'stripe-signature': 'sig_test' },
    });

    const response = await POST(request as any);
    const json = await response.json();

    expect(json.success).toBe(true);
    expect(mockChargeRecurringBilling).toHaveBeenCalled();

    process.env.STRIPE_WEBHOOK_SECRET = origSecret;
  });
});
