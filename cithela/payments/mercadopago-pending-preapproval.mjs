/**
 * CITHELA / Mercado Pago — server-only contract for WITHOUT-PLAN, PENDING preapprovals.
 *
 * SAFETY: pure builders and validators only. NO network requests, DB writes,
 * payments, entitlement changes or checkout links generated locally.
 * In particular, this file is NOT an endpoint and is NOT deployed.
 * A future server adapter must authenticate Auth.getUser(), bind the actual
 * owner + tenant + amount from a trusted private intent, require final consent,
 * serialize provider creation to avoid duplicate subscriptions on retry, and
 * persist a provider-confirmed identity before offering the returned init_point.
 *
 * Docs: https://www.mercadopago.com.ar/developers/es/docs/subscriptions/
 * integration-configuration/subscription-no-associated-plan/pending-payments
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REF=/^cithela_[A-Za-z0-9_-]{12,100}$/;
const NUMERIC=/^[0-9]{1,30}$/;
const PREAPPROVAL_ID=/^[A-Za-z0-9_-]{1,100}$/;
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RETURN_URL='https://spuklab.github.io/spuklab-builds/cithela/';
const TERM='internal-test-only-v1';
const MONEY_MAX=100000000000;

export function preparePendingTestPreapproval({enabled=false,intent,actor,consent=false,nowMs=Date.now()}={}){
 // Test-only guard: a marketing button cannot bypass the verified backend.
 if(enabled!==true)return {ok:false,code:'disabled'};
 if(!intent||!actor ||!UUID.test(intent.tenant_id||'') ||
   !UUID.test(intent.intent_id||'') ||!UUID.test(intent.owner_user_id||'') ||
   actor.id!==intent.owner_user_id ||actor.emailConfirmed!==true ||
   typeof actor.email!=='string'||actor.email.length>254||!EMAIL.test(actor.email) ||
   !REF.test(intent.external_reference||'')||
   !NUMERIC.test(intent.collector_id||'')||
   !Number.isSafeInteger(intent.amount_minor)||
   intent.amount_minor<100||intent.amount_minor>MONEY_MAX ||
   intent.currency_id!=='ARS'||intent.live_mode!==false||
   intent.terms_version!==TERM||intent.stage!=='prepared'||
   intent.provider_subscription_id!==null){
   return {ok:false,code:'invalid_trusted_intent'};
 }
 // The accepted terms must be bound to the verified owner and this exact
 // test intent by the server. This flag alone is NOT adequate browser consent.
 if(consent!==true)return {ok:false,code:'explicit_test_consent_required'};
 const consentAt=Date.parse(intent.opted_in_at);
 if(!Number.isFinite(nowMs)||!Number.isFinite(consentAt)||
   consentAt>nowMs+60_000||nowMs-consentAt>15*60_000)
   return {ok:false,code:'test_consent_expired'};
 const amount=Number((intent.amount_minor/100).toFixed(2));
 return {ok:true,code:'test_preapproval_payload_ready',
  // This payload must be sent only by a dedicated server-side adapter using
  // provider credentials expressly configured for TEST use.
  body:{
   reason:'CITHELA - prueba interna de suscripcion mensual',
   external_reference:intent.external_reference,
   payer_email:actor.email.trim().toLowerCase(),
   back_url:RETURN_URL,
   status:'pending',
   auto_recurring:{
    frequency:1,frequency_type:'months',
    transaction_amount:amount,currency_id:'ARS'
   }
  },
  expected:{
   intent_id:intent.intent_id,owner_user_id:intent.owner_user_id,
   tenant_id:intent.tenant_id,external_reference:intent.external_reference,
   collector_id:intent.collector_id,amount_minor:intent.amount_minor,
   currency_id:'ARS',live_mode:false
  }
 };
}
function toMinor(amount){
 if(typeof amount!=='string'&&typeof amount!=='number')return null;
 const n=String(amount).match(/^(0|[1-9][0-9]{0,10})(?:\.([0-9]{1,2}))?$/);
 if(!n)return null;
 return Number(n[1])*100+Number((n[2]||'').padEnd(2,'0'));
}
function sameId(a,b){
 return (typeof a==='number'||typeof a==='string')&&String(a)===String(b);
}
export function inspectPendingPreapprovalResponse(response,expected){
 if(!response||typeof response!=='object'||Array.isArray(response)||
  !expected||!REF.test(expected.external_reference||'')||
  !NUMERIC.test(expected.collector_id||'')||
  !Number.isSafeInteger(expected.amount_minor)||
  expected.currency_id!=='ARS'||expected.live_mode!==false)
  return {ok:false,code:'invalid_expected_order'};
 if(!PREAPPROVAL_ID.test(response.id||'')||
   !sameId(response.collector_id,expected.collector_id)||
   response.external_reference!==expected.external_reference)
  return {ok:false,code:'provider_identity_mismatch'};
 const recurring=response.auto_recurring;
 if(response.status!=='pending'||response.preapproval_plan_id||
   !recurring||recurring.frequency!==1||
   recurring.frequency_type!=='months'||recurring.currency_id!=='ARS'||
   toMinor(recurring.transaction_amount)!==expected.amount_minor||
   recurring.free_trial)
  return {ok:false,code:'provider_terms_mismatch'};
 let checkout;
 try{
  checkout=new URL(response.init_point);
 }catch{return {ok:false,code:'invalid_checkout_url'};}
 // Never return a URL provided by a browser or invented from a subscription ID.
 if(checkout.protocol!=='https:'||checkout.hostname!=='www.mercadopago.com.ar'||
   checkout.port!==''||checkout.username||checkout.password||checkout.hash||
   checkout.pathname!=='/subscriptions/checkout'||
   checkout.searchParams.getAll('preapproval_id').length!==1||
   checkout.searchParams.get('preapproval_id')!==String(response.id))
  return {ok:false,code:'invalid_checkout_url'};
 // Still NOT proof of authorization/payment. Only a verified provider GET
 // and idempotent DB linkage can make this checkout URL usable by a buyer.
 return {ok:true,code:'provider_checkout_verified_unpaid',
  provider_subscription_id:String(response.id),checkout_url:checkout.href,
  payment_confirmed:false,entitlement_activated:false};
}
