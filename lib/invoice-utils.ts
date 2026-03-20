/**
 * Shared utility for marking Stripe invoices as paid with verification and fallback.
 *
 * Pattern: try attachPayment → verify → fallback to paid_out_of_band if needed.
 * This ensures invoices actually transition to 'paid' regardless of beta API behavior.
 */
import { stripe } from '@/lib/stripe';

export async function markInvoicePaidWithFallback(
  invoiceId: string,
  paymentRecordId: string | null,
  logPrefix: string
): Promise<{ paid: boolean; invoiceStatus: string }> {
  // Step 1: Try attachPayment if we have a payment record
  if (paymentRecordId) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (stripe.invoices as any).attachPayment(invoiceId, {
        payment_record: paymentRecordId,
      });
      console.log(`${logPrefix} attachPayment succeeded for invoice: ${invoiceId}`);
    } catch (err) {
      console.warn(`${logPrefix} attachPayment failed for invoice ${invoiceId}:`, err);
    }
  }

  // Step 2: Re-fetch invoice to verify status
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const invoice = await stripe.invoices.retrieve(invoiceId) as any;

  if (invoice.status === 'paid') {
    console.log(`${logPrefix} Invoice verified as paid: ${invoiceId}`);
    return { paid: true, invoiceStatus: 'paid' };
  }

  // Step 3: Fallback — force pay via paid_out_of_band
  console.log(`${logPrefix} Invoice still ${invoice.status} after attachPayment, falling back to paid_out_of_band: ${invoiceId}`);
  try {
    await stripe.invoices.pay(invoiceId, { paid_out_of_band: true });
    console.log(`${logPrefix} paid_out_of_band succeeded for invoice: ${invoiceId}`);
    return { paid: true, invoiceStatus: 'paid' };
  } catch (fallbackErr) {
    console.error(`${logPrefix} paid_out_of_band also failed for invoice ${invoiceId}:`, fallbackErr);
    return { paid: false, invoiceStatus: invoice.status };
  }
}
