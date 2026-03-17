/**
 * Subscribe Setup Page - Handles HitPay redirect after payment method authorization.
 *
 * This page is called when HitPay redirects back after the customer authorizes
 * their payment method for auto-charge subscriptions.
 *
 * Flow:
 * 1. Parse URL parameters from HitPay redirect
 * 2. Verify authorization was successful (status=active)
 * 3. Show "close this tab" message — the HitPay webhook handles charging the first invoice
 *
 * Note: The first invoice is charged by the HitPay `recurring_billing.method_attached`
 * webhook (app/api/hitpay/webhook/route.ts). This page does NOT charge the invoice
 * to avoid double-charging.
 */
'use client';

import { useEffect, useState, useRef, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';

// =============================================================================
// SETUP CONTENT COMPONENT
// =============================================================================

function SetupContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  // Get params from URL
  const subscriptionId = searchParams.get('subscription_id');
  const customerId = searchParams.get('customer_id');
  const invoiceId = searchParams.get('invoice_id');
  // HitPay adds these params after redirect
  const reference = searchParams.get('reference'); // Our reference (subscription ID)
  const status = searchParams.get('status');

  // State
  const [step, setStep] = useState<'verifying' | 'success' | 'error'>('verifying');
  const [error, setError] = useState<string | null>(null);

  // Prevent duplicate processing
  const hasProcessed = useRef(false);

  useEffect(() => {
    // Validate required params
    if (!subscriptionId || !customerId || !invoiceId) {
      setStep('error');
      setError('Missing required parameters. Please try the subscription process again.');
      return;
    }

    // Prevent duplicate processing
    if (hasProcessed.current) {
      return;
    }
    hasProcessed.current = true;

    const processSetup = async () => {
      try {
        console.log('[Setup] Processing HitPay redirect for subscription:', subscriptionId);
        console.log('[Setup] HitPay reference:', reference, 'status:', status);

        // Check HitPay redirect status
        // HitPay sets status=active when payment method was successfully saved
        if (status && status !== 'active') {
          throw new Error(
            'Payment authorization was not completed. Please try again.'
          );
        }

        // Authorization received — redirect to success page.
        // The HitPay webhook (recurring_billing.method_attached) will charge the
        // first invoice in the background.
        setStep('success');
        const params = new URLSearchParams({
          subscription_id: subscriptionId,
          method: 'auto_charge',
        });
        router.push(`/subscribe/success?${params.toString()}`);
      } catch (err) {
        console.error('[Setup] Error:', err);
        setStep('error');
        setError(err instanceof Error ? err.message : 'An unexpected error occurred');
      }
    };

    processSetup();
  }, [subscriptionId, customerId, invoiceId, reference, status, router]);

  return (
    <div className="max-w-lg mx-auto py-16">
      <div className="bg-white rounded-lg shadow-md p-8">
        {step === 'verifying' && (
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto"></div>
            <h2 className="mt-6 text-xl font-semibold text-gray-900">
              Verifying Payment Method
            </h2>
            <p className="mt-2 text-gray-600">
              Please wait while we verify your payment authorization...
            </p>
          </div>
        )}

        {step === 'success' && (
          <div className="text-center">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
              <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="mt-6 text-xl font-semibold text-gray-900">
              Payment method authorized!
            </h2>
            <p className="mt-2 text-gray-600">
              Redirecting to your subscription confirmation...
            </p>
          </div>
        )}

        {step === 'error' && (
          <div className="text-center">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto">
              <svg className="w-8 h-8 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h2 className="mt-6 text-xl font-semibold text-gray-900">
              Setup Failed
            </h2>
            <p className="mt-2 text-red-600">{error}</p>
            <div className="mt-6 space-y-3">
              <Link
                href="/subscriptions"
                className="block w-full bg-gray-100 text-gray-700 py-3 rounded-lg hover:bg-gray-200 transition-colors font-medium text-center"
              >
                Start Over
              </Link>
              <Link
                href="/"
                className="block w-full bg-gray-100 text-gray-700 py-3 rounded-lg hover:bg-gray-200 transition-colors font-medium text-center"
              >
                Return Home
              </Link>
            </div>
          </div>
        )}
      </div>

      {/* Debug Info (for development) */}
      {process.env.NODE_ENV === 'development' && (
        <div className="mt-4 bg-gray-50 border border-gray-200 rounded-lg p-4">
          <h3 className="font-medium text-gray-900 text-sm mb-2">Debug Info</h3>
          <pre className="text-xs text-gray-600 overflow-auto">
            {JSON.stringify(
              {
                subscriptionId,
                customerId,
                invoiceId,
                reference,
                status,
                step,
              },
              null,
              2
            )}
          </pre>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// LOADING FALLBACK
// =============================================================================

function LoadingFallback() {
  return (
    <div className="max-w-lg mx-auto py-16">
      <div className="bg-white rounded-lg shadow-md p-8">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto"></div>
          <h2 className="mt-6 text-xl font-semibold text-gray-900">Loading...</h2>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// PAGE COMPONENT
// =============================================================================

export default function SetupPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <SetupContent />
    </Suspense>
  );
}
