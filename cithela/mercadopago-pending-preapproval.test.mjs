import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 preparePendingTestPreapproval,inspectPendingPreapprovalResponse
} from './payments/mercadopago-pending-preapproval.mjs';

const owner='22222222-2222-4222-8222-222222222222';
const tenant='33333333-3333-4333-8333-333333333333';
const intentId='44444444-4444-4444-8444-444444444444';
const consentTime=Date.parse('2026-11-08T20:00:00.000Z');
const amountMinor=1800000; // fictional test value, NOT approved commercial price.
const intent={
 intent_id:intentId,tenant_id:tenant,owner_user_id:owner,
 external_reference:'cithela_TEST_INTERNAL_123456789',
 collector_id:'200300400',amount_minor:amountMinor,
 currency_id:'ARS',live_mode:false,terms_version:'internal-test-only-v1',
 stage:'prepared',provider_subscription_id:null,
 opted_in_at:new Date(consentTime).toISOString()
};
const actor={id:owner,email:'OWNER@example.com',emailConfirmed:true};
const enabled={enabled:true,intent,actor,consent:true,nowMs:consentTime+1000};
function response(prepared){
 return {
  id:'PREAPPROVAL_123456',collector_id:200300400,
  external_reference:prepared.expected.external_reference,
  status:'pending',preapproval_plan_id:null,
  auto_recurring:{frequency:1,frequency_type:'months',
   transaction_amount:'18000.00',currency_id:'ARS'},
  init_point:'https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_id=PREAPPROVAL_123456'
 };
}
test('disabled unless explicitly test-enabled and fresh matching owner consent',()=>{
 assert.deepEqual(preparePendingTestPreapproval({intent,actor,consent:true}),
  {ok:false,code:'disabled'});
 for(const opts of [
  {consent:false},{actor:{...actor,id:tenant}},
  {actor:{...actor,emailConfirmed:false}},
  {actor:{...actor,email:'invalid-email'}},
  {intent:{...intent,tenant_id:'fake'}},
  {intent:{...intent,terms_version:'commercial-live-v1'}},
  {intent:{...intent,live_mode:true}},
  {intent:{...intent,stage:'linked'}},
  {intent:{...intent,provider_subscription_id:'sub_1'}},
  {intent:{...intent,collector_id:'x'}},
  {intent:{...intent,amount_minor:0}},
  {intent:{...intent,currency_id:'USD'}},
  {intent:{...intent,external_reference:'tenant_user_input'}},
  {nowMs:consentTime+16*60_000},
  {nowMs:consentTime-2*60_000}
 ]){
  const result=preparePendingTestPreapproval({...enabled,...opts});
  assert.equal(result.ok,false,JSON.stringify(opts));
 }
});
test('pending-only provider payload fixes monthly ARS price from private test intent',()=>{
 const p=preparePendingTestPreapproval(enabled);
 assert.equal(p.ok,true);
 assert.equal(p.body.status,'pending');
 assert.equal(p.body.payer_email,'owner@example.com');
 assert.equal(p.body.back_url,'https://spuklab.github.io/spuklab-builds/cithela/');
 assert.equal(p.body.external_reference,intent.external_reference);
 assert.deepEqual(p.body.auto_recurring,{
  frequency:1,frequency_type:'months',transaction_amount:18000,currency_id:'ARS'
 });
 assert.ok(!('card_token_id' in p.body));
 assert.ok(!('free_trial' in p.body));
 assert.ok(!('tenant_id' in p.body));
 assert.ok(!('token' in p.body));
 assert.ok(!('access_token' in p.body));
 assert.ok(!('preapproval_plan_id' in p.body));
 assert.ok(!('checkout_url' in p.body));
});
test('provider response must match merchant, reference, subscription and terms',()=>{
 const prepared=preparePendingTestPreapproval(enabled);
 const good=inspectPendingPreapprovalResponse(response(prepared),prepared.expected);
 assert.equal(good.ok,true);
 assert.equal(good.payment_confirmed,false);
 assert.equal(good.entitlement_activated,false);
 assert.equal(good.provider_subscription_id,'PREAPPROVAL_123456');
 for(const patch of [
  {collector_id:88},{external_reference:'cithela_other_customer_123456'},
  {status:'authorized'},{status:'paused'},
  {preapproval_plan_id:'some_plan'},
  {auto_recurring:{frequency:1,frequency_type:'months',
   transaction_amount:'18000.01',currency_id:'ARS'}},
  {auto_recurring:{frequency:1,frequency_type:'days',
   transaction_amount:18000,currency_id:'ARS'}},
  {auto_recurring:{frequency:1,frequency_type:'months',
   transaction_amount:18000,currency_id:'ARS',free_trial:{frequency:7}}},
  {id:'https://evil.example'}
 ]){
  const bad=inspectPendingPreapprovalResponse({...response(prepared),...patch},prepared.expected);
  assert.equal(bad.ok,false,JSON.stringify(patch));
 }
});
test('never accept phishing URLs, HTTP, duplicated preapproval IDs or different IDs',()=>{
 const prepared=preparePendingTestPreapproval(enabled);
 const valid=response(prepared);
 for(const url of [
  'http://www.mercadopago.com.ar/subscriptions/checkout?preapproval_id='+valid.id,
  'https://www.mercadopago.com.ar.evil.example/subscriptions/checkout?preapproval_id='+valid.id,
  'https://mercadopago.com.ar.evil.example/subscriptions/checkout?preapproval_id='+valid.id,
  'https://evil.example/subscriptions/checkout?preapproval_id='+valid.id,
  'https://www.mercadopago.com.ar/other?preapproval_id='+valid.id,
  'https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_id=someone_else',
  'https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_id='+valid.id+'&preapproval_id=someone_else',
  'https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_id='+valid.id+'#other',
  'https://user:password@www.mercadopago.com.ar/subscriptions/checkout?preapproval_id='+valid.id,
  'not-a-url'
 ]){
  const bad=inspectPendingPreapprovalResponse({...valid,init_point:url},prepared.expected);
  assert.deepEqual(bad,{ok:false,code:'invalid_checkout_url'},url);
 }
});
test('checkout contract contains no network, billing writes, or secrets',()=>{
 const code=readFileSync(new URL('./payments/mercadopago-pending-preapproval.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(code,/fetch\s*\(|\.insert\s*\(|\.update\s*\(|Authorization\s*:\s*['"]Bearer|Deno\.env|SUPABASE_SERVICE_ROLE_KEY/);
 assert.match(code,/server-only contract/);
 assert.match(code,/NO network requests, DB writes/);
});
