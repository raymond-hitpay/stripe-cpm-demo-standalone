/**
 * Tests for complete-stripe-payment (Stripe card auto-charge path).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/stripe', () => ({
  stripe: {
    invoices: {
      retrieve: vi.fn(),
      pay: vi.fn(),
    },
    paymentIntents: {
      retrieve: vi.fn(),
    },
    subscriptions: {
      retrieve: vi.fn(),
    },
  },
}));

import { stripe } from '@/lib/stripe';
import { POST } from '@/app/api/subscription/complete-stripe-payment/route';

const mockStripe = stripe as any;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/subscription/complete-stripe-payment', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

function makeInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: 'in_test',
    status: 'open',
    amount_due: 2990,
    currency: 'sgd',
    payment_intent: 'pi_test',
    subscription: { id: 'sub_test', status: 'incomplete' },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/subscription/complete-stripe-payment', () => {
  it('10. Invoice already paid: returns success immediately', async () => {
    mockStripe.invoices.retrieve.mockResolvedValueOnce(
      makeInvoice({ status: 'paid', subscription: { id: 'sub_test', status: 'active' } })
    );

    const res = await POST(makeRequest({ invoiceId: 'in_test' }) as any);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.invoiceStatus).toBe('paid');
    expect(mockStripe.paymentIntents.retrieve).not.toHaveBeenCalled();
  });

  it('11. PI succeeded, invoice auto-paid by Stripe on re-fetch', async () => {
    mockStripe.invoices.retrieve
      .mockResolvedValueOnce(makeInvoice()) // initial: open
      .mockResolvedValueOnce(makeInvoice({ status: 'paid', subscription: { id: 'sub_test', status: 'active' } })); // re-fetch: paid

    mockStripe.paymentIntents.retrieve.mockResolvedValueOnce({
      id: 'pi_test',
      status: 'succeeded',
      invoice: 'in_test',
    });

    mockStripe.subscriptions.retrieve.mockResolvedValueOnce({ id: 'sub_test', status: 'active' });

    const res = await POST(makeRequest({ invoiceId: 'in_test', paymentIntentId: 'pi_test' }) as any);
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(json.invoiceStatus).toBe('paid');
    expect(mockStripe.invoices.pay).not.toHaveBeenCalled();
  });

  it('12. PI succeeded, invoice still open — falls back to invoices.pay()', async () => {
    mockStripe.invoices.retrieve
      .mockResolvedValueOnce(makeInvoice()) // initial
      .mockResolvedValueOnce(makeInvoice({ status: 'open' })); // re-fetch: still open

    mockStripe.paymentIntents.retrieve.mockResolvedValueOnce({
      id: 'pi_test',
      status: 'succeeded',
      invoice: 'in_test',
    });

    mockStripe.invoices.pay.mockResolvedValueOnce({});
    mockStripe.subscriptions.retrieve.mockResolvedValueOnce({ id: 'sub_test', status: 'active' });

    const res = await POST(makeRequest({ invoiceId: 'in_test', paymentIntentId: 'pi_test' }) as any);
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(json.invoiceStatus).toBe('paid');
    expect(mockStripe.invoices.pay).toHaveBeenCalledWith('in_test');
  });

  it('13. PI succeeded, both auto-pay and fallback fail', async () => {
    mockStripe.invoices.retrieve
      .mockResolvedValueOnce(makeInvoice())
      .mockResolvedValueOnce(makeInvoice({ status: 'open' }));

    mockStripe.paymentIntents.retrieve.mockResolvedValueOnce({
      id: 'pi_test',
      status: 'succeeded',
      invoice: 'in_test',
    });

    mockStripe.invoices.pay
      .mockRejectedValueOnce(new Error('pay failed'))
      .mockRejectedValueOnce(new Error('oob also failed'));

    const res = await POST(makeRequest({ invoiceId: 'in_test', paymentIntentId: 'pi_test' }) as any);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toContain('could not be marked as paid');
  });

  it('14. PI not linked to invoice: returns 400', async () => {
    mockStripe.invoices.retrieve.mockResolvedValueOnce(
      makeInvoice({ payment_intent: 'pi_other' })
    );

    mockStripe.paymentIntents.retrieve.mockResolvedValueOnce({
      id: 'pi_test',
      status: 'succeeded',
      invoice: null,
    });

    const res = await POST(makeRequest({ invoiceId: 'in_test', paymentIntentId: 'pi_test' }) as any);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('not linked');
  });

  it('15. PI in unexpected status: returns 400', async () => {
    mockStripe.invoices.retrieve.mockResolvedValueOnce(makeInvoice());

    mockStripe.paymentIntents.retrieve.mockResolvedValueOnce({
      id: 'pi_test',
      status: 'requires_action',
      invoice: 'in_test',
    });

    const res = await POST(makeRequest({ invoiceId: 'in_test', paymentIntentId: 'pi_test' }) as any);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('unexpected status');
  });
});
