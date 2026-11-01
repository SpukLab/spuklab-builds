// Server-only adapter. Not imported by CITHELA or deployed as an endpoint.
// No trial is created at Mercado Pago. Checkout is a separate explicit decision.
const API = 'https://api.mercadopago.com';
export const PROPOSED_AMOUNT = 18000;
function fail(code) { throw new Error(code); }
export async function verifyWebhook({signature, requestId, dataId, secret, now = Date.now()}) {
  if (!secret || !requestId || !/^[a-zA-Z0-9-]{1,200}$/.test(requestId) ||
      !/^[a-zA-Z0-9_-]{1,200}$/.test(String(dataId || ''))) return false;
  const parts = String(signature || '').split(',').map(p => p.trim().split('='));
  if (parts.length !== 2 || new Set(parts.map(p => p[0])).size !== 2 || parts.some(p => p.length !== 2)) return false;
  const fields = Object.fromEntries(parts);
  if (!/^\d{10,13}$/.test(fields.ts || '') || !/^[a-f0-9]{64}$/i.test(fields.v1 || '')) return false;
  const timestamp = Number(fields.ts) * (fields.ts.length === 10 ? 1000 : 1);
  if (!Number.isFinite(now) || Math.abs(now - timestamp) > 300000) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), {name:'HMAC',hash:'SHA-256'}, false, ['verify']);
  const bytes = Uint8Array.from(fields.v1.match(/../g), v => parseInt(v,16));
  const manifest = `id:${String(dataId).toLowerCase()};request-id:${requestId};ts:${fields.ts};`;
  return crypto.subtle.verify('HMAC', key, bytes, new TextEncoder().encode(manifest));
}
function safeReturnUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) fail('invalid_return_url');
  return url.href;
}
export function subscriptionBody({reference, email, consent, backUrl, amount}) {
  // Amount comes from approved server configuration, never request JSON.
  if (consent !== true) fail('consent_required');
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(reference || '')) fail('invalid_reference');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '')) fail('invalid_email');
  if (!Number.isSafeInteger(amount) || amount <= 0) fail('invalid_amount');
  return {reason:'CITHELA · Suscripción mensual',external_reference:reference,payer_email:email,
    back_url:safeReturnUrl(backUrl),status:'pending',
    auto_recurring:{frequency:1,frequency_type:'months',transaction_amount:amount,currency_id:'ARS'}};
}
export function createMercadoPago({enabled = false, accessToken, fetchImpl = fetch}) {
  async function call(path, method = 'GET', body) {
    if (enabled !== true || !accessToken) fail('payments_disabled');
    const response = await fetchImpl(API + path,{method,redirect:'error',
      signal:AbortSignal.timeout(10000),headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json'},
      ...(body ? {body:JSON.stringify(body)} : {})});
    if (!response.ok) fail('provider_error'); // Do not propagate provider PII or tokens.
    return response.json();
  }
  const id = value => {
    if (!/^[a-zA-Z0-9_-]{1,200}$/.test(String(value || ''))) fail('invalid_provider_id');
    return encodeURIComponent(value);
  };
  return Object.freeze({
    // Caller must persist a pending checkout under a DB lock before invoking.
    // Ambiguous timeout: reconcile by reference; NEVER blindly create a second subscription.
    create: options => call('/preapproval','POST',subscriptionBody(options)),
    subscription: value => call('/preapproval/' + id(value)),
    payment: value => call('/v1/payments/' + id(value)),
    cancel: value => call('/preapproval/' + id(value),'PUT',{status:'canceled'})
  });
}
export function confirmPayment({payment, subscription, expected, now = Date.now()}) {
  // Input objects must be fetched server-to-server AFTER authenticating notification.
  // An authorized preapproval is permission to charge, not proof of payment.
  if (!expected || payment?.status !== 'approved' || subscription?.status !== 'authorized') return false;
  if (String(subscription.id) !== String(expected.subscriptionId) ||
      subscription.external_reference !== expected.reference ||
      payment.external_reference !== expected.reference ||
      String(payment.collector_id) !== String(expected.collectorId) ||
      payment.currency_id !== 'ARS' || payment.transaction_amount !== expected.amount ||
      subscription.auto_recurring?.currency_id !== 'ARS' ||
      subscription.auto_recurring?.transaction_amount !== expected.amount ||
      subscription.auto_recurring?.frequency !== 1 || subscription.auto_recurring?.frequency_type !== 'months' ||
      payment.live_mode !== expected.liveMode || typeof expected.liveMode !== 'boolean') return false;
  const approved = Date.parse(payment.date_approved);
  return Number.isFinite(approved) && approved <= now && approved >= Date.parse(expected.checkoutCreatedAt);
}
