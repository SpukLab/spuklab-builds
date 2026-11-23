import {verifySubscriptionPayment} from './mercadopago-payment-proof.mjs';

const numericId = /^[0-9]{1,30}$/;
const resourceId = /^[A-Za-z0-9_-]{1,120}$/;
const fail = code => ({ok:false,code});

export async function reconcilePilotPayment({invoiceId, getProvider, getIntent, record}) {
  if (!numericId.test(invoiceId ?? '')) return fail('invalid_invoice_id');
  const invoice = await getProvider('/authorized_payments/' + invoiceId);
  const subscriptionId = invoice?.preapproval_id;
  const paymentId = String(invoice?.payment?.id ?? invoice?.payment_id ?? '');
  if (String(invoice?.id) !== invoiceId || !resourceId.test(subscriptionId ?? '') ||
      !numericId.test(paymentId)) return fail('invoice_mismatch');

  const intent = await getIntent(subscriptionId);
  if (!intent || intent.provider_subscription_id !== subscriptionId) return fail('intent_mismatch');
  const [seller,subscription,payment] = await Promise.all([
    getProvider('/users/me'),
    getProvider('/preapproval/' + subscriptionId),
    getProvider('/v1/payments/' + paymentId)
  ]);
  const verifiedTestSeller = String(seller?.id)===String(intent.collector_id) &&
    seller?.site_id==='MLA' && Array.isArray(seller?.tags) && seller.tags.includes('test_user');
  const proof = verifySubscriptionPayment({intent,subscription,authorizedPayment:invoice,payment,verifiedTestSeller});
  if (!proof.ok) return proof;
  if (!Number.isFinite(Date.parse(payment.date_approved))) return fail('invalid_approval_date');

  return record({
    p_subscription_id:subscriptionId,p_invoice_id:invoiceId,p_payment_id:paymentId,
    p_approved_at:payment.date_approved,p_collector_id:intent.collector_id,
    p_amount_minor:intent.amount_minor
  });
}
