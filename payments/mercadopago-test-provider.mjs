/**
 * CITHELA Mercado Pago subscription provider adapter.
 * Server-side ONLY. Does not grant entitlements or process webhook claims.
 * Caller must verify a prepared intent, authenticated tenant owner, merchant,
 * explicit consent and test seller credential BEFORE invoking create.
 * NOTE: pending preapprovals are NOT automatic recurring charges; this is a
 * pending-payment flow only. Use authorized preapproval for automatic billing.
 */
const BASE='https://api.mercadopago.com';
const REF=/^cithela_[A-Za-z0-9_-]{12,100}$/;
const ID=/^[A-Za-z0-9_-]{1,120}$/;
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const fail=(code)=>({ok:false,code});
const validIntent=(i)=>!!i&&i.live_mode===false&&i.currency_id==='ARS'&&
  REF.test(i.external_reference||'')&&Number.isSafeInteger(i.amount_minor)&&
  i.amount_minor>=100&&i.amount_minor<=100000000000&&
  i.terms_version==='internal-test-only-v1'&&
  /^[0-9]{1,30}$/.test(i.collector_id||'');

export function buildTestPreapproval(intent,payerEmail,backUrl){
  if(!validIntent(intent))return fail('invalid_test_intent');
  if(typeof payerEmail!=='string'||payerEmail.length>254||!EMAIL.test(payerEmail))
    return fail('invalid_payer');
  let u;try{u=new URL(backUrl);}catch{return fail('invalid_return_url');}
  if(u.protocol!=='https:'||u.origin!=='https://spuklab.github.io'||
     !u.pathname.startsWith('/spuklab-builds/cithela/'))
    return fail('invalid_return_url');
  return {ok:true,body:{
    reason:'CITHELA — suscripción de prueba',
    external_reference:intent.external_reference,
    payer_email:payerEmail,
    back_url:u.toString(),
    auto_recurring:{frequency:1,frequency_type:'months',
      transaction_amount:intent.amount_minor/100,currency_id:'ARS'},
    status:'pending'
  }};
}
export async function createTestPreapproval({intent,payerEmail,backUrl,token,fetchImpl=fetch}){
  const built=buildTestPreapproval(intent,payerEmail,backUrl);
  if(!built.ok)return built;
  if(typeof token!=='string'||!/^APP_USR-[A-Za-z0-9-]{16,}$/.test(token))
    return fail('test_credential_missing');
  if(typeof fetchImpl!=='function')return fail('network_unavailable');
  try{
    const response=await fetchImpl(BASE+'/preapproval',{
      method:'POST',headers:{Authorization:'Bearer '+token,
        'Content-Type':'application/json','Accept':'application/json',
        'X-Idempotency-Key':intent.external_reference},
      body:JSON.stringify(built.body),signal:AbortSignal.timeout(12000)
    });
    if(!response.ok)return fail(response.status===401?'credential_rejected':
      response.status===429?'provider_rate_limited':'provider_rejected');
    const data=await response.json();
    if(!ID.test(data?.id||'')||data.external_reference!==intent.external_reference||
       data.status!=='pending'||typeof data.init_point!=='string')
      return fail('unexpected_provider_response');
    const checkout=new URL(data.init_point);
    if(checkout.protocol!=='https:'||
       !/(^|\.)mercadopago\.(com|com\.ar)$/.test(checkout.hostname))
      return fail('invalid_checkout_origin');
    return {ok:true,code:'created_pending_payment_not_authorized',provider_subscription_id:data.id,
      checkout_url:checkout.toString()};
  }catch{return fail('provider_unavailable');}
}
export async function readTestPreapproval({subscriptionId,token,fetchImpl=fetch}){
  if(!ID.test(subscriptionId||''))return fail('invalid_subscription_id');
  if(typeof token!=='string'||!/^APP_USR-[A-Za-z0-9-]{16,}$/.test(token))
    return fail('test_credential_missing');
  try{
    const response=await fetchImpl(BASE+'/preapproval/'+encodeURIComponent(subscriptionId),{
      headers:{Authorization:'Bearer '+token,Accept:'application/json'},
      signal:AbortSignal.timeout(12000)});
    if(!response.ok)return fail(response.status===404?'subscription_not_found':'provider_unavailable');
    const d=await response.json();
    if(d?.id!==subscriptionId||!REF.test(d.external_reference||''))
      return fail('unexpected_provider_response');
    return {ok:true,code:'read_only',provider_subscription_id:d.id,
      external_reference:d.external_reference,status:d.status,
      payer_id:d.payer_id??null};
  }catch{return fail('provider_unavailable');}
}

/** Strict provider-to-intent comparison. Never infer payment approval here. */
export function validateTestSubscriptionSnapshot(intent,snapshot){
 if(!validIntent(intent)||!snapshot?.ok||snapshot.code!=='read_only'||
    snapshot.external_reference!==intent.external_reference||
    snapshot.provider_subscription_id!==intent.provider_subscription_id)
   return fail('subscription_intent_mismatch');
 // Subscription status alone does not prove a successful recurring charge.
 return {ok:true,code:'subscription_identity_verified',
   subscription_status:snapshot.status,payment_verified:false,
   entitlement_activation_allowed:false};
}
