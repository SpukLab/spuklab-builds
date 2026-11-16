import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyPayPalSandboxWebhook} from './payments/paypal-sandbox-webhook.mjs';

const event={id:'WH-TEST123456789',event_type:'PAYMENT.SALE.COMPLETED',
 resource:{id:'TESTSALE123456789'}};
const headers={
 'paypal-transmission-id':'TESTTRANS123456789',
 'paypal-transmission-sig':'A'.repeat(48),
 'paypal-transmission-time':'2026-11-16T18:00:00Z',
 'paypal-auth-algo':'SHA256withRSA',
 'paypal-cert-url':'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-123456789'
};
function good(fetchImpl){
 return {enabled:true,environment:'sandbox',webhookId:'WH-CITHELASANDBOX123',
 token:'sandbox-access-token-for-tests',headers,event,fetchImpl};
}
test('disabled by default; reject live mode and malformed event',async()=>{
 const mock=async()=>({ok:true,json:async()=>({verification_status:'SUCCESS'})});
 assert.equal((await verifyPayPalSandboxWebhook({...good(mock),enabled:false})).code,'disabled');
 assert.equal((await verifyPayPalSandboxWebhook({...good(mock),environment:'live'})).ok,false);
 assert.equal((await verifyPayPalSandboxWebhook({...good(mock),event:{...event,event_type:'ANY'}})).ok,false);
 assert.equal((await verifyPayPalSandboxWebhook({...good(mock),event:{...event,resource:{}}})).ok,false);
});
test('verified signature does not confirm payment or activate access',async()=>{
 let called=0;
 const mock=async (url,options)=>{
  called++;
  assert.equal(url,'https://api-m.sandbox.paypal.com/v1/notifications/verify-webhook-signature');
  assert.equal(options.method,'POST');
  const input=JSON.parse(options.body);
  assert.equal(input.webhook_id,'WH-CITHELASANDBOX123');
  assert.equal(input.webhook_event.event_type,'PAYMENT.SALE.COMPLETED');
  return {ok:true,json:async()=>({verification_status:'SUCCESS'})};
 };
 const r=await verifyPayPalSandboxWebhook(good(mock));
 assert.equal(called,1);
 assert.equal(r.ok,true);
 assert.equal(r.payment_confirmed,false);
 assert.equal(r.entitlement_activated,false);
 assert.equal(r.event_id,event.id);
});
test('invalid certificate hosts and signature headers never call PayPal',async()=>{
 let calls=0;const mock=async()=>{calls++;return {ok:true};};
 for(const patch of [
  {headers:{...headers,'paypal-cert-url':'https://evil.example/v1/notifications/certs/CERT-123456789'}},
  {headers:{...headers,'paypal-cert-url':'https://api.sandbox.paypal.com.evil.example/v1/notifications/certs/CERT-123456789'}},
  {headers:{...headers,'paypal-cert-url':'http://api.sandbox.paypal.com/v1/notifications/certs/CERT-123456789'}},
  {headers:{...headers,'paypal-cert-url':'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-123456789?x=1'}},
  {headers:{...headers,'paypal-auth-algo':'none'}},
  {headers:{...headers,'paypal-transmission-sig':'a'}},
  {headers:{...headers,'paypal-transmission-time':'invalid'}}
 ]){
  assert.equal((await verifyPayPalSandboxWebhook({...good(mock),...patch})).ok,false);
 }
 assert.equal(calls,0);
});
test('failed PayPal postback or invalid status cannot become verified',async()=>{
 const failure=await verifyPayPalSandboxWebhook(good(async()=>({
  ok:true,json:async()=>({verification_status:'FAILURE'})})));
 assert.equal(failure.ok,false);
 assert.equal(failure.code,'signature_not_verified');
 const network=await verifyPayPalSandboxWebhook(good(async()=>{throw Error('network');}));
 assert.equal(network.code,'verification_unavailable');
});
