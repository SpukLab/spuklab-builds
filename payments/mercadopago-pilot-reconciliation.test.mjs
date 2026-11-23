import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcilePilotPayment} from './mercadopago-pilot-reconciliation.mjs';
const intent={stage:'linked',live_mode:false,provider_subscription_id:'sub_123',external_reference:'cithela_1234567890123456',
 collector_id:'3813812326',currency_id:'ARS',amount_minor:100000};
const invoice={id:'987',preapproval_id:'sub_123',payment_id:456};
const subscription={id:'sub_123',external_reference:intent.external_reference,collector_id:3813812326,
 auto_recurring:{currency_id:'ARS',transaction_amount:1000}};
const payment={id:456,status:'approved',date_approved:'2026-11-22T22:30:00Z',collector_id:3813812326,
 live_mode:false,currency_id:'ARS',transaction_amount:1000};
const seller={id:3813812326,site_id:'MLA',tags:['test_user']};
function fixture({sellerOverrides={},subscriptionOverrides={},paymentOverrides={}}={}){
 let recorded=false;const calls=[];
 const getProvider=async path=>{
  calls.push(path);
  if(path.startsWith('/authorized_payments/'))return invoice;
  if(path==='/users/me')return {...seller,...sellerOverrides};
  if(path.startsWith('/preapproval/'))return {...subscription,...subscriptionOverrides};
  if(path.startsWith('/v1/payments/'))return {...payment,...paymentOverrides};
  throw Error('unexpected request');
 };
 return {input:{invoiceId:'987',getProvider,getIntent:async()=>intent,
    record:async()=>{recorded=true;return {ok:true,code:'recorded'};}},calls,wasRecorded:()=>recorded};
}
test('verifies test seller when MP omits subscription live_mode before recording',async()=>{
 const f=fixture();
 const r=await reconcilePilotPayment(f.input);
 assert.equal(r.ok,true);
 assert.equal(f.wasRecorded(),true);
 assert.ok(f.calls.includes('/users/me'));
});
test('rejects unverified seller, production mode, or mismatched payment',async()=>{
 for(const opts of [
  {sellerOverrides:{tags:[]}},
  {sellerOverrides:{id:111}},
  {subscriptionOverrides:{live_mode:true}},
  {paymentOverrides:{live_mode:undefined}},
  {paymentOverrides:{status:'pending'}}
 ]) {
  const f=fixture(opts),r=await reconcilePilotPayment(f.input);
  assert.equal(r.ok,false);
  assert.equal(f.wasRecorded(),false);
 }
});
