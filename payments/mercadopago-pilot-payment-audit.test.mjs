import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectExistingPilotPayment as audit} from './mercadopago-pilot-payment-audit.mjs';
const subscriptionId='sub_1234';
const buyerId='3813812328';
const intent={stage:'linked',live_mode:false,currency_id:'ARS',amount_minor:100000,
 collector_id:'3813812326',provider_subscription_id:subscriptionId,external_reference:'cithela_abcdefghijkl'};
const seller={id:3813812326,site_id:'MLA',tags:['test_user']};
const subscription={id:subscriptionId,collector_id:3813812326,payer_id:buyerId,
 external_reference:intent.external_reference,auto_recurring:{currency_id:'ARS',transaction_amount:1000}};
const invoice={id:123,preapproval_id:subscriptionId,payment:{id:456}};
const payment={id:456,status:'approved',date_approved:'2026-11-23T03:27:00Z',
 currency_id:'ARS',transaction_amount:1000,collector_id:3813812326,live_mode:false};
function fixture({sellerOver={},subscriptionOver={},paymentOver={},invoiceOver={},searchOver={}}={}){
 const calls=[];
 const getProvider=async path=>{
  calls.push(path);
  if(path==='/users/me')return {...seller,...sellerOver};
  if(path==='/preapproval/'+subscriptionId)return {...subscription,...subscriptionOver};
  if(path.startsWith('/authorized_payments/search?'))
   return {paging:{total:1},results:[{...invoice,...invoiceOver}],...searchOver};
  if(path==='/authorized_payments/123')return {...invoice,...invoiceOver};
  if(path==='/v1/payments/456')return {...payment,...paymentOver};
  throw Error('Unexpected GET '+path);
 };
 return {calls,getProvider};
}
test('verifies approved original test payment using only provider GET calls',async()=>{
 const t=fixture();
 const r=await audit({intent,getProvider:t.getProvider,buyerId});
 assert.deepEqual(r,{ok:true,code:'approved_test_payment_verified_read_only',
  verified_payments:1,entitlement_activation_allowed:false});
 assert.deepEqual(t.calls,[
  '/users/me','/preapproval/'+subscriptionId,
  '/authorized_payments/search?preapproval_id=sub_1234&limit=50&offset=0',
  '/authorized_payments/123','/v1/payments/456'
 ]);
});
test('never accepts wrong seller, buyer or live_mode',async()=>{
 for(const opts of [{sellerOver:{tags:[]}},{sellerOver:{id:9999}},
   {subscriptionOver:{payer_id:'wrong'}},{subscriptionOver:{live_mode:true}},
   {paymentOver:{live_mode:true}},{paymentOver:{live_mode:null}},
   {paymentOver:{collector_id:'wrong'}},{paymentOver:{status:'pending'}}]){
  const t=fixture(opts),r=await audit({intent,getProvider:t.getProvider,buyerId});
  assert.equal(r.ok,false,JSON.stringify(opts));
 }
});
test('does not confuse an invoice of another subscription or amount',async()=>{
 for(const opts of [{invoiceOver:{preapproval_id:'other'}},
   {paymentOver:{transaction_amount:900}},{paymentOver:{currency_id:'USD'}}]){
  const t=fixture(opts),r=await audit({intent,getProvider:t.getProvider,buyerId});
  assert.equal(r.ok,false,JSON.stringify(opts));
 }
});
test('fails closed on incomplete search and requires linked intent',async()=>{
 const t=fixture({searchOver:{paging:{total:501}}});
 assert.equal((await audit({intent,getProvider:t.getProvider,buyerId})).code,'invoice_search_incomplete');
 assert.equal((await audit({intent:{...intent,stage:'prepared'},getProvider:t.getProvider,buyerId})).code,'linked_test_intent_required');
});
