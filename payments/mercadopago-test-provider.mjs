/**
 * CITHELA Mercado Pago subscription provider adapter.
 * Server-side ONLY. Does not grant entitlements or process webhook claims.
 * Caller must verify a prepared intent, authenticated tenant owner, merchant,
 * explicit consent and test seller credential BEFORE invoking create.
 * NOTE: pending preapprovals are NOT automatic recurring charges; this is a
 * pending-payment flow only. Use authorized preapproval for automatic billing.
 */
import {classifyPreapprovalValidation,safePreapprovalErrorMetadata,safePreapprovalMessageHints} from './mercadopago-error-classifier.mjs';
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
    if(!response.ok){
      // No raw response body: it can contain account identifiers or PII.
      const category=response.status===401||response.status===403?'credential_rejected':
        response.status===429?'provider_rate_limited':
        response.status===400||response.status===422?'provider_validation_rejected':
        response.status>=500?'provider_server_error':'provider_rejected';
      let validation_reason='not_applicable';
      let response_shape='not_applicable',provider_code='unavailable',message_hints=[];
      const content_type=response.headers?.get('content-type')?.toLowerCase()||'';
      if((response.status===400||response.status===422) &&
         (content_type.includes('application/json')||content_type.includes('+json'))){
        // Read in memory only, never persist the raw provider payload.
        const details=await response.json().catch(()=>null);
        validation_reason=classifyPreapprovalValidation(details);
        ({response_shape,provider_code}=safePreapprovalErrorMetadata(details));
        message_hints=safePreapprovalMessageHints(details);
      }else if(response.status===400||response.status===422){
        response_shape='non_json';
      }
      console.warn('cithela_mp_provider_diagnostic',JSON.stringify({
        operation:'create_preapproval',http_status:response.status,category,
        validation_reason,response_shape,provider_code,message_hints
      }));
      return fail(category);
    }
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
  }catch(error){
    console.warn('cithela_mp_provider_diagnostic',JSON.stringify({
      operation:'create_preapproval',category:
        error?.name==='TimeoutError'?'timeout':'network_or_parse_error'
    }));
    return fail('provider_unavailable');
  }
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
      payer_id:d.payer_id??null,collector_id:d.collector_id??null,
      live_mode:d.live_mode,
      amount:(typeof d.auto_recurring?.transaction_amount==='number' ||
        (typeof d.auto_recurring?.transaction_amount==='string' &&
         /^\d+(?:\.\d{1,2})?$/.test(d.auto_recurring.transaction_amount)))
        ? Number(d.auto_recurring.transaction_amount) : null,
      currency_id:d.auto_recurring?.currency_id};
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

/** Verify seller and financial identity before any server-side binding. */
export function verifyTestProviderIdentity(intent,snapshot){
 if(!validIntent(intent)||!snapshot?.ok||snapshot.code!=='read_only'||
   snapshot.external_reference!==intent.external_reference||
   String(snapshot.collector_id)!==intent.collector_id||
   snapshot.live_mode!==false||snapshot.currency_id!=='ARS'||
   typeof snapshot.amount!=='number'||!Number.isFinite(snapshot.amount)||
   Math.round(snapshot.amount*100)!==intent.amount_minor||
   !ID.test(snapshot.provider_subscription_id||''))
   return fail('provider_identity_mismatch');
 return {ok:true,code:'provider_identity_verified',
   provider_subscription_id:snapshot.provider_subscription_id,
   payment_verified:false,entitlement_activation_allowed:false};
}

/**
 * Fail-closed decision for whether a test checkout may be exposed.
 * A successful eligibility check alone is never sufficient.
 * Do not allow real money or public tenant checkout via this gate.
 */
export function authorizeInternalTestCheckout({
  tenantId,ownerEmail,confirmedOwner,preflight,explicitConsent,
  serverFeatureEnabled,verifiedTestSeller,verifiedTestBuyer
}={}){
  if(tenantId!=='e680ebd3-a031-4968-905a-e829ab3b5dfe'||
     String(ownerEmail||'').toLowerCase()!=='alma.y.pampa@gmail.com'||
     confirmedOwner!==true)return fail('internal_owner_only');
  if(preflight?.ok!==true||preflight.code!=='eligible')
    return fail('preflight_required');
  if(explicitConsent!==true)return fail('explicit_consent_required');
  if(serverFeatureEnabled!==true)return fail('checkout_disabled');
  if(verifiedTestSeller!==true||verifiedTestBuyer!==true)
    return fail('test_accounts_unverified');
  return {ok:true,code:'test_checkout_gate_open',
    entitlement_activation_allowed:false};
}
