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
  // Step 0: Log initial invoice state for diagnostics
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const preInvoice = await stripe.invoices.retrieve(invoiceId, { expand: ['payment_intent'] }) as any;
  const prePI = preInvoice.payment_intent;
  console.log(`${logPrefix} [markInvoicePaid] BEFORE — invoice: ${invoiceId}, status: ${preInvoice.status}, collection_method: ${preInvoice.collection_method}, amount_due: ${preInvoice.amount_due}`);
  console.log(`${logPrefix} [markInvoicePaid] BEFORE — PI: ${prePI?.id || 'none'}, PI status: ${prePI?.status || 'n/a'}, PI payment_method: ${prePI?.payment_method || 'none'}`);

  // Step 1: Try attachPayment if we have a payment record
  if (paymentRecordId) {
    console.log(`${logPrefix} [markInvoicePaid] Attempting attachPayment with paymentRecord: ${paymentRecordId}`);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const attachResult = await (stripe.invoices as any).attachPayment(invoiceId, {
        payment_record: paymentRecordId,
      });
      console.log(`${logPrefix} [markInvoicePaid] attachPayment succeeded for invoice: ${invoiceId}, result:`, JSON.stringify(attachResult, null, 2));
    } catch (err) {
      const errObj = err instanceof Error ? { message: err.message, name: err.name, ...(err as any) } : err;
      console.warn(`${logPrefix} [markInvoicePaid] attachPayment FAILED for invoice ${invoiceId}:`, JSON.stringify(errObj, null, 2));
    }
  } else {
    console.log(`${logPrefix} [markInvoicePaid] No paymentRecordId — skipping attachPayment`);
  }

  // Step 2: Re-fetch invoice to verify status
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const invoice = await stripe.invoices.retrieve(invoiceId, { expand: ['payment_intent'] }) as any;
  const postPI = invoice.payment_intent;
  console.log(`${logPrefix} [markInvoicePaid] AFTER attachPayment — invoice status: ${invoice.status}, PI: ${postPI?.id || 'none'}, PI status: ${postPI?.status || 'n/a'}`);

  if (invoice.status === 'paid') {
    console.log(`${logPrefix} [markInvoicePaid] Invoice verified as paid: ${invoiceId}`);
    return { paid: true, invoiceStatus: 'paid' };
  }

  // Step 3: Fallback — force pay via paid_out_of_band
  console.log(`${logPrefix} [markInvoicePaid] Invoice still ${invoice.status} after attachPayment, attempting paid_out_of_band: ${invoiceId}`);
  try {
    await stripe.invoices.pay(invoiceId, { paid_out_of_band: true });
    console.log(`${logPrefix} [markInvoicePaid] paid_out_of_band succeeded for invoice: ${invoiceId}`);
    return { paid: true, invoiceStatus: 'paid' };
  } catch (fallbackErr) {
    const errObj = fallbackErr instanceof Error ? { message: fallbackErr.message, name: fallbackErr.name, ...(fallbackErr as any) } : fallbackErr;
    console.error(`${logPrefix} [markInvoicePaid] paid_out_of_band ALSO FAILED for invoice ${invoiceId}:`, JSON.stringify(errObj, null, 2));
    return { paid: false, invoiceStatus: invoice.status };
  }
}
