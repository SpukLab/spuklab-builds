/**
 * CITHELA commercial billing — Mercado Pago webhook origin validator.
 *
 * Server-only pure WebCrypto helper. NOT a webhook endpoint and NOT deployed.
 * Docs: https://www.mercadopago.com.ar/developers/es/docs/checkout-api-orders/optional-notifications
 * A valid signature authenticates the notification, but is NOT proof of
 * subscription payment, currency, invoice state, entitlement or tenant.
 * Always GET the resource from Mercado Pago with a server access token, verify
 * payer/merchant/amount/currency/status and reconcile idempotently.
 */
export async function verifyMercadoPagoSignature(request, secret, cryptoProvider=globalThis.crypto) {
  if (!request || typeof request.url!=='string' || !request.headers ||
      typeof secret!=='string' || secret.length<16 ||
      !cryptoProvider?.subtle || !cryptoProvider?.subtle?.importKey) return false;
  let uri;
  try { uri=new URL(request.url); } catch { return false; }
  // Mercado Pago supplies data.id in query params; never derive an ID from a
  // notification body, which is untrusted until independently reconciled.
  const ids=uri.searchParams.getAll('data.id');
  const dataId=ids.length===1?ids[0]:'';
  const requestId=request.headers.get('x-request-id')||'';
  const signature=request.headers.get('x-signature')||'';
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(dataId) ||
      !/^[^;\r\n]{1,200}$/.test(requestId) ||
      signature.length>320) return false;
  const attrs=Object.create(null);
  for(const part of signature.split(',')){
    const pos=part.indexOf('=');
    if(pos<1) return false;
    const name=part.slice(0,pos).trim();
    const value=part.slice(pos+1).trim();
    if(!/^(ts|v1)$/.test(name) || Object.prototype.hasOwnProperty.call(attrs,name))return false;
    attrs[name]=value;
  }
  if (!/^\d{10,16}$/.test(attrs.ts||'')||!/^[0-9a-fA-F]{64}$/.test(attrs.v1||''))return false;
  const message=`id:${dataId};request-id:${requestId};ts:${attrs.ts};`;
  try {
    const encoding=new TextEncoder();
    const key=await cryptoProvider.subtle.importKey('raw',encoding.encode(secret),
      {name:'HMAC',hash:'SHA-256'},false,['verify']);
    const bytes=new Uint8Array((attrs.v1.match(/.{2}/g)||[]).map(x=>Number.parseInt(x,16)));
    return await cryptoProvider.subtle.verify('HMAC',key,bytes,encoding.encode(message));
  } catch {
    return false;
  }
}
