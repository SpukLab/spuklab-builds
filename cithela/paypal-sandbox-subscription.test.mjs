import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {preparePayPalSandboxSubscription,inspectPayPalSandboxCreateResponse}
  from './payments/paypal-sandbox-subscription.mjs';

const user='22222222-2222-4222-8222-222222222222';
const date=Date.parse('2026-11-16T18:00:00Z');
const intent={
 intent_id:'33333333-3333-4333-8333-333333333333',
 tenant_id:'44444444-4444-4444-8444-444444444444',
 owner_user_id:user,external_reference:'cithela_SBOX_ABC123456789',
 provider:'paypal',environment:'sandbox',currency_id:'USD',
 paypal_plan_id:'P-TEST1234567890123',amount_minor:1900,
 stage:'prepared',terms_version:'internal-test-only-v1',
 provider_subscription_id:null,opted_in_at:new Date(date).toISOString()
};
const plan={environment:'sandbox',currency_id:'USD',interval_unit:'month',
 interval_count:1,is_verified:true,paypal_plan_id:intent.paypal_plan_id,
 amount_minor:1900};
const actor={id:user,emailConfirmed:true};
const good={enabled:true,intent,plan,actor,consent:true,nowMs:date+1000};
function response(){
 return {id:'I-TEST123456789012',plan_id:intent.paypal_plan_id,
 custom_id:intent.external_reference,status:'APPROVAL_PENDING',
 links:[{rel:'approve',method:'GET',href:
 'https://www.sandbox.paypal.com/webapps/billing/subscriptions?ba_token=BA-TEST123456789012'}]};
}
test('fail-closed, fresh consent, ownership, sandbox and trusted USD price',()=>{
 assert.deepEqual(preparePayPalSandboxSubscription({...good,enabled:false}),
 {ok:false,code:'disabled'});
 for(const patch of [
  {consent:false},{actor:{id:intent.tenant_id,emailConfirmed:true}},
  {actor:{id:user,emailConfirmed:false}},
  {intent:{...intent,provider:'mercadopago'}},
  {intent:{...intent,environment:'live'}},
  {intent:{...intent,currency_id:'ARS'}},
  {intent:{...intent,stage:'linked'}},
  {intent:{...intent,provider_subscription_id:'I-123456789'}},
  {intent:{...intent,terms_version:'live-v1'}},
  {intent:{...intent,amount_minor:1}},
  {intent:{...intent,paypal_plan_id:'evil'}},
  {plan:{...plan,amount_minor:2000}},
  {plan:{...plan,environment:'live'}},
  {plan:{...plan,is_verified:false}},
  {nowMs:date+16*60*1000},{nowMs:date-2*60*1000}
 ]) assert.equal(preparePayPalSandboxSubscription({...good,...patch}).ok,false,
   JSON.stringify(patch));
});
test('payload contains only a server-bound plan and safe return routes',()=>{
 const r=preparePayPalSandboxSubscription(good);
 assert.equal(r.ok,true);
 assert.deepEqual(r.body,{
  plan_id:intent.paypal_plan_id,custom_id:intent.external_reference,
  application_context:{brand_name:'CITHELA · SpukLab',
   user_action:'SUBSCRIBE_NOW',
   return_url:'https://spuklab.github.io/spuklab-builds/cithela/',
   cancel_url:'https://spuklab.github.io/spuklab-builds/cithela/'}
 });
 assert.equal(r.entitlement_activated,false);
 assert.equal(r.payment_confirmed,false);
 assert.ok(!('amount' in r.body));
});
test('PayPal response must remain pending and match verified plan/reference',()=>{
 const expected=preparePayPalSandboxSubscription(good).expected;
 const valid=inspectPayPalSandboxCreateResponse(response(),expected);
 assert.equal(valid.ok,true);
 assert.equal(valid.entitlement_activated,false);
 assert.equal(valid.payment_confirmed,false);
 for(const p of [
  {id:'I-INVALID/'},{plan_id:'P-OTHER12345678'},
  {custom_id:'cithela_OTHER_123456789'},{status:'ACTIVE'},
  {status:'APPROVED'},{status:'SUSPENDED'},
  {links:[{rel:'approve',method:'POST',
   href:response().links[0].href}]}
 ])assert.equal(inspectPayPalSandboxCreateResponse({...response(),...p},expected).ok,false);
});
test('reject phishing, HTTP, other paths, duplicate approval links and tokens',()=>{
 const expected=preparePayPalSandboxSubscription(good).expected;
 const goodUrl=response().links[0].href;
 for(const href of [
  goodUrl.replace('https:','http:'),
  goodUrl.replace('sandbox.paypal.com','sandbox.paypal.com.evil.example'),
  'https://evil.example/webapps/billing/subscriptions?ba_token=BA-TEST123456789012',
  'https://www.sandbox.paypal.com/signin?ba_token=BA-TEST123456789012',
  goodUrl.replace('BA-TEST123456789012','BA-TEST123456789012&ba_token=BA-OTHER123456'),
  goodUrl+'#fake',goodUrl.replace('https://','https://user:pass@'),
  'not-a-url'
 ])assert.equal(inspectPayPalSandboxCreateResponse({
  ...response(),links:[{rel:'approve',method:'GET',href}]},expected).ok,false,href);
 assert.equal(inspectPayPalSandboxCreateResponse({
  ...response(),links:[...response().links,...response().links]},expected).ok,false);
});
test('contract cannot perform network, data or entitlement writes',()=>{
 const code=readFileSync(new URL('./payments/paypal-sandbox-subscription.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(code,/\bfetch\s*\(|\.insert\s*\(|\.update\s*\(|Deno\.env|SUPABASE_SERVICE_ROLE_KEY/);
});
