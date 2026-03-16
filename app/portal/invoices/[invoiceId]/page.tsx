/**
 * Customer Portal - Invoice Detail & Payment Page
 *
 * Shows full invoice details and allows payment of open invoices.
 * - Out-of-band invoices: Stripe Elements + HitPay QR flow
 * - Auto-charge invoices: Simulate Auto-Charge button
 */
'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Elements } from '@stripe/react-stripe-js';
import { stripePromise } from '@/lib/stripe-client';
import { InvoicePaymentForm } from '@/components/InvoicePaymentForm';
import { getOneTimeCpms } from '@/config/payment-methods';

// =============================================================================
// TYPES
// =============================================================================

interface Customer {
  id: string;
  email: string;
  name: string;
  metadata: Record<string, string>;
}

interface Invoice {
  id: string;
  amount_due: number;
  amount_paid: number;
  currency: string;
  status: string;
  due_date: number | null;
  period_start: number;
  period_end: number;
  subscription_id: string | null;
  billing_reason: string | null;
  hosted_invoice_url: string | null;
  collection_method: string;
}

// =============================================================================
// HELPERS
// =============================================================================

function formatCurrency(amount: number, currency: string) {
  return new Intl.NumberFormat('en-SG', {
    style: 'currency',
    currency: currency.toUpperCase() || 'SGD',
  }).format(amount / 100);
}

function formatDate(ts: number | null) {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleDateString('en-SG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    paid: 'bg-green-100 text-green-700',
    open: 'bg-yellow-100 text-yellow-700',
    draft: 'bg-gray-100 text-gray-600',
    void: 'bg-gray-100 text-gray-500',
    uncollectible: 'bg-red-100 text-red-600',
  };
  const label: Record<string, string> = {
    paid: 'Paid',
    open: 'Open',
    draft: 'Draft',
    void: 'Void',
    uncollectible: 'Uncollectible',
  };
  const cls = styles[status] || 'bg-gray-100 text-gray-600';
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {label[status] || status}
    </span>
  );
}

// =============================================================================
// DETAIL CONTENT
// =============================================================================

function InvoiceDetailContent({ invoiceId }: { invoiceId: string }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const customerId = searchParams.get('customerId');

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Payment state (out-of-band)
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [isCreatingPayment, setIsCreatingPayment] = useState(false);
  const [isPaid, setIsPaid] = useState(false);

  // Auto-charge state
  const [isSimulating, setIsSimulating] = useState(false);
  const [simulateResult, setSimulateResult] = useState<{ success: boolean; message: string } | null>(null);

  // ─── Load data ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!customerId) {
      router.push('/portal');
      return;
    }

    const loadData = async () => {
      try {
        const [customerRes, invoiceRes] = await Promise.all([
          fetch(`/api/portal/customer?customerId=${customerId}`),
          fetch(`/api/portal/invoices/${invoiceId}?customerId=${customerId}`),
        ]);

        if (!customerRes.ok) {
          const err = await customerRes.json();
          setError(err.error || 'Customer not found');
          return;
        }

        if (!invoiceRes.ok) {
          const err = await invoiceRes.json();
          setError(err.error || 'Invoice not found');
          return;
        }

        const [customerData, invoiceData] = await Promise.all([
          customerRes.json(),
          invoiceRes.json(),
        ]);

        setCustomer(customerData);
        setInvoice(invoiceData);
      } catch {
        setError('Failed to load invoice. Please try again.');
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, [customerId, invoiceId, router]);

  const hasAutoCharge = !!customer?.metadata?.hitpay_recurring_billing_id;
  const effectiveStatus = isPaid ? 'paid' : (invoice?.status ?? '');
  const isOpen = effectiveStatus === 'open';

  // ─── Create payment intent for out-of-band pay ───────────────────────────

  useEffect(() => {
    if (!invoice || !isOpen || hasAutoCharge || clientSecret) return;

    const createIntent = async () => {
      setIsCreatingPayment(true);
      try {
        const res = await fetch('/api/create-payment-intent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount: invoice.amount_due,
            currency: invoice.currency,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to create payment');
        setClientSecret(data.clientSecret);
      } catch (err) {
        console.error('[InvoiceDetail] Create payment intent error:', err);
      } finally {
        setIsCreatingPayment(false);
      }
    };

    createIntent();
  }, [invoice, isOpen, hasAutoCharge, clientSecret]);

  // ─── Simulate auto-charge ─────────────────────────────────────────────────

  const handleSimulateCharge = async () => {
    if (!invoice) return;
    setIsSimulating(true);
    try {
      const res = await fetch('/api/subscription/charge-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId: invoice.id }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        setIsPaid(true);
        setSimulateResult({ success: true, message: 'Auto-charge succeeded!' });
      } else {
        setSimulateResult({
          success: false,
          message: data.error || data.message || 'Charge failed',
        });
      }
    } catch {
      setSimulateResult({ success: false, message: 'Request failed. Please try again.' });
    } finally {
      setIsSimulating(false);
    }
  };

  // ─── Elements config ─────────────────────────────────────────────────────

  const oneTimeCpms = getOneTimeCpms();
  const elementsOptions = clientSecret
    ? {
        clientSecret,
        appearance: { theme: 'stripe' as const },
        customPaymentMethods: oneTimeCpms.map((pm) => ({
          id: pm.id,
          options: { type: 'static' as const },
        })),
      }
    : null;

  // ─── Loading / error ─────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto" />
          <p className="mt-3 text-sm text-gray-600">Loading invoice...</p>
        </div>
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div className="max-w-2xl mx-auto py-16 px-4">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
          <p className="text-red-700 font-medium">{error || 'Invoice not found'}</p>
          <Link
            href={`/portal/invoices?customerId=${customerId}`}
            className="mt-4 inline-block text-sm text-indigo-600 hover:text-indigo-700 underline"
          >
            Back to Invoices
          </Link>
        </div>
      </div>
    );
  }

  // ─── Main render ─────────────────────────────────────────────────────────

  return (
    <div className="max-w-2xl mx-auto py-8 px-4">
      {/* Back link */}
      <Link
        href={`/portal/invoices?customerId=${customerId}`}
        className="text-indigo-600 hover:text-indigo-700 text-sm font-medium"
      >
        &larr; Back to Invoices
      </Link>

      {/* Invoice header card */}
      <div className="mt-6 bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Invoice</h1>
            <p className="mt-1 font-mono text-sm text-gray-500">{invoice.id}</p>
          </div>
          <StatusBadge status={effectiveStatus} />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-gray-500">Period</p>
            <p className="font-medium text-gray-900 mt-0.5">
              {formatDate(invoice.period_start)} – {formatDate(invoice.period_end)}
            </p>
          </div>
          {invoice.billing_reason && (
            <div>
              <p className="text-gray-500">Billing reason</p>
              <p className="font-medium text-gray-900 mt-0.5 capitalize">
                {invoice.billing_reason.replace(/_/g, ' ')}
              </p>
            </div>
          )}
          <div>
            <p className="text-gray-500">Amount due</p>
            <p className="text-2xl font-bold text-gray-900 mt-0.5">
              {formatCurrency(invoice.amount_due, invoice.currency)}
            </p>
          </div>
          {invoice.due_date && (
            <div>
              <p className="text-gray-500">Due date</p>
              <p className="font-medium text-gray-900 mt-0.5">{formatDate(invoice.due_date)}</p>
            </div>
          )}
        </div>

        {invoice.hosted_invoice_url && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <a
              href={invoice.hosted_invoice_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-indigo-600 hover:text-indigo-700"
            >
              View PDF Invoice
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          </div>
        )}
      </div>

      {/* Paid banner */}
      {!isOpen && effectiveStatus === 'paid' && (
        <div className="mt-6 bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3">
          <svg className="w-5 h-5 text-green-600 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
          <p className="text-green-800 font-medium">This invoice has been paid.</p>
        </div>
      )}

      {/* Payment success banner (just paid) */}
      {isPaid && (
        <div className="mt-6 bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3">
          <svg className="w-5 h-5 text-green-600 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
          <p className="text-green-800 font-medium">Payment successful!</p>
        </div>
      )}

      {/* Payment section — open + out-of-band */}
      {isOpen && !hasAutoCharge && (
        <div className="mt-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Pay This Invoice</h2>

          {isCreatingPayment && (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-indigo-600" />
              Setting up payment...
            </div>
          )}

          {!isCreatingPayment && clientSecret && elementsOptions && stripePromise && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <Elements
                stripe={stripePromise}
                options={elementsOptions as never}
                key={clientSecret}
              >
                <InvoicePaymentForm
                  invoiceId={invoice.id}
                  amount={invoice.amount_due}
                  currency={invoice.currency}
                  onSuccess={(hitpayPaymentId) => {
                    console.log('[InvoiceDetail] Invoice paid:', invoice.id, hitpayPaymentId);
                    setIsPaid(true);
                  }}
                  onCancel={() => router.push(`/portal/invoices?customerId=${customerId}`)}
                />
              </Elements>
            </div>
          )}
        </div>
      )}

      {/* Payment section — open + auto-charge */}
      {isOpen && hasAutoCharge && !simulateResult && (
        <div className="mt-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Pay This Invoice</h2>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <p className="text-sm text-gray-600 mb-4">
              Your saved payment method will be charged automatically.
            </p>
            <button
              onClick={handleSimulateCharge}
              disabled={isSimulating}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSimulating ? (
                <>
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Charging...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
                  </svg>
                  Simulate Auto-Charge
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Auto-charge result */}
      {simulateResult && (
        <div
          className={`mt-6 rounded-xl p-4 flex items-center gap-3 border ${
            simulateResult.success
              ? 'bg-green-50 border-green-200'
              : 'bg-red-50 border-red-200'
          }`}
        >
          {simulateResult.success ? (
            <svg className="w-5 h-5 text-green-600 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
          ) : (
            <svg className="w-5 h-5 text-red-600 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          )}
          <p className={`font-medium text-sm ${simulateResult.success ? 'text-green-800' : 'text-red-700'}`}>
            {simulateResult.message}
          </p>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// PAGE
// =============================================================================

function LoadingFallback() {
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto" />
        <p className="mt-3 text-sm text-gray-600">Loading...</p>
      </div>
    </div>
  );
}

export default function InvoiceDetailPage({
  params,
}: {
  params: { invoiceId: string };
}) {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <InvoiceDetailContent invoiceId={params.invoiceId} />
    </Suspense>
  );
}
