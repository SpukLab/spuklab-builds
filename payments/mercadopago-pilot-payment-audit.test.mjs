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
  '/authorized_payments/search?preapproval_id=sub_1234',
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

test('on exactly HTTP 400 for primary search, retries documented payer ID with strict subscription match',async()=>{
 const calls=[];
 const t=fixture();
 const reader=async path=>{
  calls.push(path);
  if(path.startsWith('/authorized_payments/search?preapproval_id=')){
   throw new Error('mp_invoice_search_http_400');
  }
  return t.getProvider(path);
 };
 const r=await audit({intent,getProvider:reader,buyerId});
 assert.equal(r.ok,true);
 assert.equal(r.verified_payments,1);
 assert.ok(calls.includes('/authorized_payments/search?payer_id='+buyerId));
 assert.ok(calls.every(path=>!path.includes('limit=')&&!path.includes('offset=')));
});
test('payer fallback ignores invoices of other subscriptions and cannot verify unrelated payment',async()=>{
 const t=fixture({searchOver:{
   paging:{total:2},results:[
    {id:222,preapproval_id:'another_subscription',payment:{id:789}},
    invoice
   ]
 }});
 const reader=async path=>{
  if(path.startsWith('/authorized_payments/search?preapproval_id='))throw new Error('mp_invoice_search_http_400');
  return t.getProvider(path);
 };
 const r=await audit({intent,getProvider:reader,buyerId});
 assert.equal(r.ok,true);
 assert.equal(r.verified_payments,1);
 assert.equal(t.calls.includes('/authorized_payments/222'),false);
});
test('payer fallback with zero matching invoices stays unverified',async()=>{
 const t=fixture({searchOver:{paging:{total:1},results:[{id:222,preapproval_id:'another_subscription',payment:{id:789}}]}});
 const reader=async path=>{
  if(path.startsWith('/authorized_payments/search?preapproval_id='))throw new Error('mp_invoice_search_http_400');
  return t.getProvider(path);
 };
 const r=await audit({intent,getProvider:reader,buyerId});
 assert.equal(r.ok,false);
 assert.equal(r.code,'invoice_not_found');
 assert.equal(t.calls.some(path=>path.startsWith('/authorized_payments/222')),false);
});
test('any authorization, network or non-400 search failure must never attempt fallback',async()=>{
 for(const code of ['mp_invoice_search_http_403','mp_invoice_search_http_401','mp_invoice_search_transport','other_error']){
  const calls=[],t=fixture();
  const reader=async path=>{
   calls.push(path);
   if(path.startsWith('/authorized_payments/search?'))throw Error(code);
   return t.getProvider(path);
  };
  await assert.rejects(audit({intent,getProvider:reader,buyerId}),/./);
  assert.equal(calls.some(path=>path.includes('payer_id=')),false);
 }
});
test('single-page pilot never silently accepts truncated invoices',async()=>{
 const t=fixture({searchOver:{paging:{total:2}}});
 assert.equal((await audit({intent,getProvider:t.getProvider,buyerId})).code,'invoice_search_incomplete');
});

test('read-only rejected payment includes all failed check categories but no provider data',async()=>{
 const t=fixture({paymentOver:{
  transaction_amount:900,collector_id:9999,live_mode:null
 }});
 const result=await audit({intent,getProvider:t.getProvider,buyerId});
 assert.equal(result.ok,false);
 assert.equal(result.code,'payment_not_verified');
 assert.deepEqual(result.checks,[
  'payment_amount_mismatch','payment_seller_mismatch','payment_mode_missing'
 ]);
 const serialized=JSON.stringify(result);
 assert.doesNotMatch(serialized,/9999|900|sub_1234|3813812328/);
});
test('approved matched payment never leaks failed_checks or weakens enforcement',async()=>{
 const t=fixture();
 const result=await audit({intent,getProvider:t.getProvider,buyerId});
 assert.equal(result.ok,true);
 assert.equal(result.checks,undefined);
 assert.equal(result.entitlement_activation_allowed,false);
});
