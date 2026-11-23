import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyLinkedTestCheckout as verify} from './mercadopago-linked-checkout.mjs';
const intent={
 stage:'linked',live_mode:false,provider_subscription_id:'sub123456',
 collector_id:'3813812326',external_reference:'cithela_abcd1234EFGH5678',
 currency_id:'ARS',amount_minor:100000
};
const buyerId='3813812328';
const detail={
 id:'sub123456',status:'pending',payer_id:buyerId,
 external_reference:intent.external_reference,collector_id:3813812326,
 auto_recurring:{currency_id:'ARS',transaction_amount:'1000.00'},
 init_point:'https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_id=sub123456'
};
const base={intent,detail,buyerId,verifiedTestSeller:true,verifiedTestBuyer:true};
test('returns only the already linked preapproval checkout URL after strict verification',()=>{
 const r=verify(base);
 assert.equal(r.ok,true);
 assert.equal(r.checkout_url,detail.init_point);
 assert.equal(r.code,'linked_test_checkout_recovered');
});
test('does not accept prepared intent, production evidence or incorrect amount',()=>{
 for(const [key,change] of [
  ['intent',{...intent,stage:'prepared'}],
  ['intent',{...intent,live_mode:true}],
  ['detail',{...detail,live_mode:true}],
  ['detail',{...detail,collector_id:'9'}],
  ['detail',{...detail,payer_id:'9'}],
  ['detail',{...detail,status:'authorized'}],
  ['detail',{...detail,external_reference:'wrong'}],
  ['detail',{...detail,auto_recurring:{currency_id:'ARS',transaction_amount:999}}],
  ['detail',{...detail,auto_recurring:{currency_id:'USD',transaction_amount:1000}}],
  ['detail',{...detail,id:'different'}]
 ]){
  const r=verify({...base,[key]:change});
  assert.equal(r.ok,false,key+' '+JSON.stringify(change));
  assert.equal(r.checkout_url,undefined);
 }
});
test('rejects unverified accounts, suspicious URLs and non test host',()=>{
 assert.equal(verify({...base,verifiedTestSeller:false}).ok,false);
 assert.equal(verify({...base,verifiedTestBuyer:false}).ok,false);
 for(const url of [
  'http://www.mercadopago.com.ar/subscriptions/checkout',
  'https://mercadopago.com.ar.attacker.com/subscriptions/checkout',
  'https://www.mercadopago.com.ar.evil.net/subscriptions/checkout',
  'https://user:pw@www.mercadopago.com.ar/subscriptions/checkout',
  'https://www.mercadopago.com.ar/payments/checkout',
  'javascript:alert(1)'
 ]){
  assert.equal(verify({...base,detail:{...detail,init_point:url}}).ok,false,url);
 }
});
