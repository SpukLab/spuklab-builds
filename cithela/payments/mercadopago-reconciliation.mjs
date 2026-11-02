/**
 * CITHELA / Mercado Pago — server-only reconciliation, READ-ONLY.
 * No access granted and no writes to CITHELA. Never expose tokens to browsers.
 * Expected values MUST come from a trusted server-owned subscription order.
 * Docs: GET /preapproval/{id}, /authorized_payments/search, /v1/payments/{id}.
 */
const API='https://api.mercadopago.com';
const SUBSCRIPTION_ID=/^[A-Za-z0-9_-]{1,100}$/;
const NUMERIC_ID=/^[0-9]{1,30}$/;
const REF=/^[A-Za-z0-9_-]{8,120}$/;

function moneyMinor(input) {
  if (typeof input!=='string'&&typeof input!=='number')return null;
  const value=String(input);
  const match=/^(0|[1-9][0-9]{0,10})(?:\.([0-9]{1,2}))?$/.exec(value);
  if(!match)return null;
  const cents=Number(match[1])*100+Number((match[2]||'').padEnd(2,'0'));
  return Number.isSafeInteger(cents)?cents:null;
}
function sameId(x,y) { return (typeof x==='string'||typeof x==='number')&&String(x)===String(y); }
const validExpected=e=>e&&SUBSCRIPTION_ID.test(e.preapprovalId||'')
  &&REF.test(e.externalReference||'')&&NUMERIC_ID.test(e.collectorId||'')
  &&Number.isSafeInteger(e.amountMinor)&&e.amountMinor>0
  &&e.currency==='ARS' &&typeof e.token==='string'&&e.token.length>=16
  &&typeof e.fetchImpl==='function';

async function providerGet(path,expected) {
  // Routes are constructed exclusively from validated IDs, never an URL
  // provided by a notification. Bearer token is never returned or logged.
  const request=await expected.fetchImpl(API+path,{
    method:'GET',
    headers:{Authorization:'Bearer '+expected.token,Accept:'application/json'},
    signal:AbortSignal.timeout(10000)
  });
  if(!request?.ok)throw Error('provider_http_error');
  const obj=await request.json();
  if(!obj||typeof obj!=='object'||Array.isArray(obj))throw Error('invalid_provider_json');
  return obj;
}

export async function inspectMercadoPagoSubscription(expected) {
  if(!validExpected(expected))return {ok:false,code:'invalid_expected_order'};
  try{
    const subscription=await providerGet('/preapproval/'+expected.preapprovalId,expected);
    if(!sameId(subscription.id,expected.preapprovalId)||
       !sameId(subscription.collector_id,expected.collectorId)||
       subscription.external_reference!==expected.externalReference)
      return {ok:false,code:'subscription_identity_mismatch'};
    const recurring=subscription.auto_recurring;
    if(!recurring||recurring.currency_id!==expected.currency||
       moneyMinor(recurring.transaction_amount)!==expected.amountMinor||
       recurring.frequency!==1||recurring.frequency_type!=='months')
      return {ok:false,code:'subscription_plan_mismatch'};
    if(subscription.status==='cancelled'||subscription.status==='canceled')
      return {ok:true,code:'provider_canceled',verified_payment:false};
    if(subscription.status!=='authorized')
      return {ok:true,code:'subscription_not_authorized',verified_payment:false};
    const invoicePage=await providerGet('/authorized_payments/search?preapproval_id='+expected.preapprovalId+
      '&limit=20&offset=0',expected);
    const invoices=invoicePage.results;
    const total=invoicePage.paging?.total;
    if(!Array.isArray(invoices)||invoices.length>20||!Number.isSafeInteger(total)||total<0)
      return {ok:false,code:'provider_invoice_invalid'};
    // A complete, verified invoice is needed; no partial history is accepted
    // to determine the current billing period if there are more than 20.
    if(total>20)return {ok:false,code:'manual_review_required'};
    let verified=null;
    for(const invoice of invoices) {
      if(!sameId(invoice.preapproval_id,expected.preapprovalId)||
         invoice.external_reference!==expected.externalReference||
         invoice.currency_id!==expected.currency||
         moneyMinor(invoice.transaction_amount)!==expected.amountMinor)
        return {ok:false,code:'invoice_identity_mismatch'};
      if(invoice.payment?.status!=='approved'||invoice.payment?.status_detail!=='accredited')continue;
      if(!NUMERIC_ID.test(String(invoice.payment?.id||'')))
        return {ok:false,code:'invoice_payment_invalid'};
      const payment=await providerGet('/v1/payments/'+invoice.payment.id,expected);
      if(!sameId(payment.id,invoice.payment.id)||
         !sameId(payment.collector_id,expected.collectorId)||
         payment.status!=='approved'||payment.status_detail!=='accredited'||
         payment.currency_id!==expected.currency||
         moneyMinor(payment.transaction_amount)!==expected.amountMinor)
        return {ok:false,code:'payment_not_verified'};
      if(expected.externalReference!==payment.external_reference &&
         payment.external_reference!=null)
        return {ok:false,code:'payment_reference_mismatch'};
      if(verified===null||Date.parse(payment.date_approved)>Date.parse(verified.date_approved))
        verified={paymentId:String(payment.id),date_approved:payment.date_approved};
    }
    if(!verified||!Number.isFinite(Date.parse(verified.date_approved)))
      return {ok:true,code:'payment_not_confirmed',verified_payment:false};
    return {ok:true,code:'confirmed_payment',verified_payment:true,
      provider_payment_id:verified.paymentId,payment_approved_at:verified.date_approved};
  }catch{
    // Never return raw provider data (payer PII, card, token, request URL).
    return {ok:false,code:'provider_unavailable'};
  }
}

export async function prepareMercadoPagoCancellation(expected) {
  // No PUT in this function. Merely establish whether a cancellation request
  // is potentially valid; enforce identity and explicit opt-in in the backend.
  if(!validExpected(expected))return {ok:false,code:'invalid_expected_order'};
  try {
    const sub=await providerGet('/preapproval/'+expected.preapprovalId,expected);
    if(!sameId(sub.id,expected.preapprovalId)||
       !sameId(sub.collector_id,expected.collectorId)||
       sub.external_reference!==expected.externalReference)
      return {ok:false,code:'subscription_identity_mismatch'};
    if(sub.status==='cancelled'||sub.status==='canceled')
      return {ok:true,code:'already_canceled',can_cancel:false};
    if(!['authorized','pending','paused'].includes(sub.status))
      return {ok:false,code:'cancellation_requires_review'};
    return {ok:true,code:'ready_for_explicit_confirmation',can_cancel:true};
  }catch {return {ok:false,code:'provider_unavailable'};}
}
