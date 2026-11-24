/**
 * CITHELA / PayPal — pure server-side subscription contract, SANDBOX ONLY.
 * NO PayPal network calls, DB writes, checkout deployment or entitlement changes.
 * Trusted intent/plan must be loaded by an authenticated backend (not browser).
 * Reference: https://developer.paypal.com/api/subscriptions/v1/
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PLAN=/^P-[A-Z0-9]{8,40}$/;
const SUB=/^I-[A-Z0-9]{6,40}$/;
const REF=/^cithela_[A-Za-z0-9_-]{12,90}$/;
const TEST_TERMS='internal-test-only-v1';
const RETURN_URL='https://spuklab.github.io/spuklab-builds/cithela/';

function invalid(code){return {ok:false,code};}
export function preparePayPalSandboxSubscription({
  enabled=false,intent,plan,actor,consent=false,nowMs=Date.now()
}={}){
  if(enabled!==true)return invalid('disabled');
  if(!intent||!plan||!actor||
    !UUID.test(intent.intent_id||'')||!UUID.test(intent.tenant_id||'')||
    !UUID.test(intent.owner_user_id||'')||actor.id!==intent.owner_user_id||
    actor.emailConfirmed!==true||
    intent.provider!=='paypal'||intent.environment!=='sandbox'||
    intent.currency_id!=='USD'||intent.stage!=='prepared'||
    intent.provider_subscription_id!==null||
    intent.terms_version!==TEST_TERMS||
    !REF.test(intent.external_reference||'')||
    !PLAN.test(intent.paypal_plan_id||'')||
    !Number.isSafeInteger(intent.amount_minor)||intent.amount_minor<100||
    intent.amount_minor>100000000||
    plan.environment!=='sandbox'||plan.currency_id!=='USD'||
    plan.interval_unit!=='month'||plan.interval_count!==1||
    plan.is_verified!==true||plan.paypal_plan_id!==intent.paypal_plan_id||
    plan.amount_minor!==intent.amount_minor) return invalid('invalid_trusted_intent');
  if(consent!==true)return invalid('explicit_test_consent_required');
  const acceptedAt=Date.parse(intent.opted_in_at);
  if(!Number.isFinite(acceptedAt)||!Number.isFinite(nowMs)||
    acceptedAt>nowMs+60000||nowMs-acceptedAt>15*60000)
    return invalid('test_consent_expired');
  const expected={
    tenant_id:intent.tenant_id,intent_id:intent.intent_id,
    owner_user_id:intent.owner_user_id,
    paypal_plan_id:intent.paypal_plan_id,
    external_reference:intent.external_reference,
    amount_minor:intent.amount_minor,currency_id:'USD',environment:'sandbox'
  };
  return {ok:true,code:'sandbox_subscription_payload_ready',expected,
    body:{
      plan_id:intent.paypal_plan_id,
      custom_id:intent.external_reference,
      application_context:{
        brand_name:'CITHELA · SpukLab',
        user_action:'SUBSCRIBE_NOW',
        return_url:RETURN_URL,
        cancel_url:RETURN_URL
      }
    },
    payment_confirmed:false,entitlement_activated:false};
}
export function inspectPayPalSandboxCreateResponse(data,expected){
  if(!data||typeof data!=='object'||Array.isArray(data)||
    !expected||expected.environment!=='sandbox'||
    !PLAN.test(expected.paypal_plan_id||'')||
    !REF.test(expected.external_reference||''))return invalid('invalid_expected_order');
  if(!SUB.test(data.id||'')||
    data.plan_id!==expected.paypal_plan_id||
    data.custom_id!==expected.external_reference)return invalid('subscription_identity_mismatch');
  if(data.status!=='APPROVAL_PENDING')return invalid('subscription_not_pending');
  const approvals=Array.isArray(data.links)?
    data.links.filter(l=>l?.rel==='approve'):[];
  if(approvals.length!==1||approvals[0].method!=='GET')
    return invalid('invalid_approval_link');
  let u;
  try{u=new URL(approvals[0].href);}catch{return invalid('invalid_approval_link');}
  // Only the approval URL returned by PayPal can be used; never fabricate one.
  if(u.protocol!=='https:'||u.port||u.username||u.password||u.hash||
    !['www.sandbox.paypal.com','sandbox.paypal.com'].includes(u.hostname)||
    !u.pathname.startsWith('/webapps/billing/subscriptions')||
    u.searchParams.getAll('ba_token').length!==1||
    !/^BA-[A-Za-z0-9-]{6,100}$/.test(u.searchParams.get('ba_token')||''))
    return invalid('invalid_approval_link');
  return {ok:true,code:'provider_approval_pending_unpaid',
    provider_subscription_id:data.id,approval_url:u.href,
    payment_confirmed:false,entitlement_activated:false};
}
