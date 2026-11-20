import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTestPreapproval,createTestPreapproval,readTestPreapproval,validateTestSubscriptionSnapshot,verifyTestProviderIdentity}
  from './mercadopago-test-provider.mjs';
const intent={live_mode:false,currency_id:'ARS',
 external_reference:'cithela_1234567890123456',amount_minor:1500000,
 terms_version:'internal-test-only-v1',collector_id:'123456789'};
const backUrl='https://spuklab.github.io/spuklab-builds/cithela/';
const token='APP_USR-12345678901234567890';
test('rejects production intent',()=>{
 assert.equal(buildTestPreapproval({...intent,live_mode:true},'buyer@example.com',backUrl).ok,false);
});
test('rejects untrusted return origin',()=>{
 assert.equal(buildTestPreapproval(intent,'buyer@example.com','https://example.com/').ok,false);
});
test('uses server-provided monthly amount',()=>{
 const r=buildTestPreapproval(intent,'buyer@example.com',backUrl);
 assert.equal(r.body.auto_recurring.transaction_amount,15000);
 assert.equal(r.body.status,'pending');
});
test('does not expose provider checkout from untrusted host',async()=>{
 const r=await createTestPreapproval({intent,payerEmail:'buyer@example.com',backUrl,token,
 fetchImpl:async()=>({ok:true,json:async()=>({
  id:'abc123',external_reference:intent.external_reference,status:'pending',
  init_point:'https://example.com/steal'})})});
 assert.equal(r.code,'invalid_checkout_origin');
});
test('creates pending checkout but never activates tenant',async()=>{
 const r=await createTestPreapproval({intent,payerEmail:'buyer@example.com',backUrl,token,
 fetchImpl:async(url,options)=>{
  assert.match(url,/\/preapproval$/);
  assert.equal(JSON.parse(options.body).status,'pending');
  return {ok:true,json:async()=>({
   id:'abc123',external_reference:intent.external_reference,status:'pending',
   init_point:'https://www.mercadopago.com.ar/subscriptions/checkout'})};
 }});
 assert.equal(r.code,'created_pending_payment_not_authorized');
 assert.equal(Object.hasOwn(r,'entitlement'),false);
});
test('provider lookup never grants access',async()=>{
 const r=await readTestPreapproval({subscriptionId:'abc123',token,
 fetchImpl:async()=>({ok:true,json:async()=>({
  id:'abc123',external_reference:intent.external_reference,status:'authorized'})})});
 assert.equal(r.status,'authorized');
 assert.equal(Object.hasOwn(r,'entitlement'),false);
});

test('subscription status alone never enables entitlement',()=>{
 const i={...intent,provider_subscription_id:'abc123'};
 const result=validateTestSubscriptionSnapshot(i,{ok:true,code:'read_only',
  provider_subscription_id:'abc123',external_reference:intent.external_reference,
  status:'authorized'});
 assert.equal(result.ok,true);
 assert.equal(result.payment_verified,false);
 assert.equal(result.entitlement_activation_allowed,false);
});
test('wrong subscription cannot be reconciled',()=>{
 const result=validateTestSubscriptionSnapshot({...intent,provider_subscription_id:'other'},
 {ok:true,code:'read_only',provider_subscription_id:'abc123',
  external_reference:intent.external_reference,status:'authorized'});
 assert.equal(result.code,'subscription_intent_mismatch');
});

test('provider seller and amount must match prepared test intent',()=>{
 const snapshot={ok:true,code:'read_only',provider_subscription_id:'abc123',
 external_reference:intent.external_reference,collector_id:intent.collector_id,
 live_mode:false,currency_id:'ARS',amount:15000,status:'pending'};
 assert.equal(verifyTestProviderIdentity(intent,snapshot).ok,true);
 assert.equal(verifyTestProviderIdentity(intent,{...snapshot,collector_id:'999'}).ok,false);
 assert.equal(verifyTestProviderIdentity(intent,{...snapshot,amount:15001}).ok,false);
 assert.equal(verifyTestProviderIdentity(intent,{...snapshot,live_mode:true}).ok,false);
 assert.equal(verifyTestProviderIdentity(intent,{...snapshot,currency_id:'USD'}).ok,false);
});
