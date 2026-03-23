/**
 * Customer Portal - Invoice List
 *
 * Displays all invoices for a customer with links to the detail/payment page.
 */
'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';

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
  refund_hitpay_id: string | null;
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
    refunded: 'bg-orange-100 text-orange-700',
  };
  const label: Record<string, string> = {
    paid: 'Paid',
    open: 'Open',
    draft: 'Draft',
    void: 'Void',
    uncollectible: 'Uncollectible',
    refunded: 'Refunded',
  };
  const cls = styles[status] || 'bg-gray-100 text-gray-600';
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {label[status] || status}
    </span>
  );
}

// =============================================================================
// MAIN CONTENT
// =============================================================================

function InvoicesContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const customerId = searchParams.get('customerId');

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!customerId) {
      router.push('/portal');
      return;
    }

    const loadData = async () => {
      try {
        const [customerRes, invoicesRes] = await Promise.all([
          fetch(`/api/portal/customer?customerId=${customerId}`),
          fetch(`/api/portal/invoices?customerId=${customerId}`),
        ]);

        if (!customerRes.ok) {
          const err = await customerRes.json();
          setError(err.error || 'Customer not found');
          return;
        }

        const customerData = await customerRes.json();
        const invoicesData = await invoicesRes.json();

        setCustomer(customerData);
        setInvoices(invoicesData.invoices || []);
      } catch {
        setError('Failed to load invoice data. Please try again.');
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, [customerId, router]);

  const hasAutoCharge = !!customer?.metadata?.hitpay_recurring_billing_id;

  // ─── Loading / error states ──────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto" />
          <p className="mt-3 text-sm text-gray-600">Loading invoices...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-2xl mx-auto py-16 px-4">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
          <p className="text-red-700 font-medium">{error}</p>
          <Link
            href="/portal"
            className="mt-4 inline-block text-sm text-indigo-600 hover:text-indigo-700 underline"
          >
            Try a different email
          </Link>
        </div>
      </div>
    );
  }

  // ─── Main render ─────────────────────────────────────────────────────────

  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      {/* Back link */}
      <Link
        href="/portal"
        className="text-indigo-600 hover:text-indigo-700 text-sm font-medium"
      >
        &larr; Back to Portal
      </Link>

      {/* Customer header */}
      <div className="mt-6 mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Your Invoices</h1>
          {customer && (
            <p className="mt-1 text-gray-600">
              {customer.name && <span className="font-medium text-gray-800">{customer.name} · </span>}
              {customer.email}
            </p>
          )}
          {hasAutoCharge && (
            <span className="mt-2 inline-flex items-center gap-1.5 text-xs text-purple-700 bg-purple-50 border border-purple-200 rounded-full px-2.5 py-0.5">
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
              </svg>
              Auto-charge enabled
            </span>
          )}
        </div>
        <Link
          href="/"
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          Home
        </Link>
      </div>

      {/* No invoices */}
      {invoices.length === 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
          <svg
            className="w-12 h-12 text-gray-300 mx-auto"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          <p className="mt-4 text-gray-500">No invoices found for this account.</p>
          <Link
            href="/subscriptions"
            className="mt-4 inline-block text-sm text-indigo-600 hover:text-indigo-700 underline"
          >
            Browse subscription plans
          </Link>
        </div>
      )}

      {/* Invoice list */}
      {invoices.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          {/* Table header */}
          <div className="hidden md:grid md:grid-cols-5 gap-4 px-6 py-3 bg-gray-50 border-b border-gray-200 text-xs font-medium text-gray-500 uppercase tracking-wide">
            <div className="col-span-2">Period</div>
            <div>Amount</div>
            <div>Status</div>
            <div className="text-right">Action</div>
          </div>

          {/* Invoice rows */}
          <div className="divide-y divide-gray-100">
            {invoices.map((invoice) => (
              <div key={invoice.id} className="grid grid-cols-2 md:grid-cols-5 gap-4 px-6 py-4 items-center">
                {/* Period */}
                <div className="col-span-2">
                  <p className="text-sm font-medium text-gray-900">
                    {formatDate(invoice.period_start)} – {formatDate(invoice.period_end)}
                  </p>
                  {invoice.billing_reason && (
                    <p className="text-xs text-gray-500 capitalize mt-0.5">
                      {invoice.billing_reason.replace(/_/g, ' ')}
                    </p>
                  )}
                  <p className="text-xs text-gray-400 font-mono mt-0.5">{invoice.id}</p>
                </div>

                {/* Amount */}
                <div>
                  <p className="text-sm font-semibold text-gray-900">
                    {formatCurrency(invoice.amount_due, invoice.currency)}
                  </p>
                  {invoice.due_date && (
                    <p className="text-xs text-gray-500 mt-0.5">
                      Due {formatDate(invoice.due_date)}
                    </p>
                  )}
                </div>

                {/* Status */}
                <div>
                  <StatusBadge status={invoice.refund_hitpay_id ? 'refunded' : invoice.status} />
                </div>

                {/* Action */}
                <div className="text-right">
                  <Link
                    href={`/portal/invoices/${invoice.id}?customerId=${customerId}`}
                    className="inline-flex items-center px-3 py-1.5 border border-gray-300 text-sm font-medium rounded-lg text-gray-700 bg-white hover:bg-gray-50 transition-colors"
                  >
                    View Details
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Info section */}
      <div className="mt-6 bg-indigo-50 border border-indigo-100 rounded-lg p-4 text-sm text-indigo-700">
        <p className="font-medium text-indigo-900 mb-1">About Your Invoices</p>
        {hasAutoCharge ? (
          <p>
            Your subscription uses auto-charge billing. Open invoices can be paid from the invoice detail page.
          </p>
        ) : (
          <p>
            Your subscription uses manual invoicing. Click &quot;View Details&quot; on any open invoice to pay via QR code or your preferred payment method.
          </p>
        )}
      </div>
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

export default function PortalInvoicesPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <InvoicesContent />
    </Suspense>
  );
}
