import test from 'node:test';
import assert from 'node:assert/strict';
import {verifySubscriptionPayment as verify} from './mercadopago-payment-proof.mjs';
const intent={stage:'linked',live_mode:false,provider_subscription_id:'sub_123',
 external_reference:'cithela_1234567890123456',collector_id:'1234',currency_id:'ARS',amount_minor:1500000};
const subscription={id:'sub_123',external_reference:intent.external_reference,collector_id:1234,
 live_mode:false,auto_recurring:{currency_id:'ARS',transaction_amount:15000}};
const authorizedPayment={preapproval_id:'sub_123',payment_id:987};
const payment={id:987,status:'approved',date_approved:'2026-11-21T12:00:00Z',
 currency_id:'ARS',transaction_amount:15000,collector_id:1234,live_mode:false};
const base={intent,subscription,authorizedPayment,payment};
test('requires matching paid invoice but does not itself activate entitlements',()=>{
 const r=verify(base);
 assert.equal(r.ok,true);
 assert.equal(r.entitlement_activation_allowed,false);
});
test('never accepts pending or rejected payment',()=>{
 for(const status of ['pending','rejected','cancelled','refunded'])
  assert.equal(verify({...base,payment:{...payment,status}}).ok,false);
});
test('rejects mismatched seller, amount, payment id, subscription, live mode',()=>{
 const variations=[
  {payment:{...payment,collector_id:555}},
  {payment:{...payment,transaction_amount:15001}},
  {payment:{...payment,live_mode:true}},
  {payment:{...payment,id:999}},
  {authorizedPayment:{...authorizedPayment,preapproval_id:'wrong'}},
  {subscription:{...subscription,external_reference:'wrong'}},
  {subscription:{...subscription,live_mode:true}}
 ];
 for(const variation of variations)
  assert.equal(verify({...base,...variation}).ok,false);
});
test('a subscription alone is never payment evidence',()=>{
 assert.equal(verify({intent,subscription}).ok,false);
});

test('omitted subscription live_mode requires verified test seller and approved test payment',()=>{
 const {live_mode,...missing}=subscription;
 assert.equal(verify({...base,subscription:missing}).ok,false);
 assert.equal(verify({...base,subscription:missing,verifiedTestSeller:true}).ok,true);
 assert.equal(verify({...base,subscription:{...missing,live_mode:true},verifiedTestSeller:true}).ok,false);
 assert.equal(verify({...base,subscription:{...missing,collector_id:9999},verifiedTestSeller:true}).ok,false);
 assert.equal(verify({...base,subscription:missing,payment:{...payment,live_mode:undefined},verifiedTestSeller:true}).ok,false);
 assert.equal(verify({...base,subscription:missing,payment:{...payment,status:'pending'},verifiedTestSeller:true}).ok,false);
});

test('payment proof diagnostics preserve exact rejection without exposing values',async()=>{
 const {diagnosePaymentProofMismatch}=await import('./mercadopago-payment-proof.mjs');
 const cases=[
  [{id:999},'payment_reference_mismatch'],
  [{status:'pending'},'payment_status_not_approved'],
  [{date_approved:null},'payment_approval_date_missing'],
  [{currency_id:'USD'},'payment_currency_mismatch'],
  [{transaction_amount:15001},'payment_amount_mismatch'],
  [{collector_id:9999},'payment_seller_mismatch'],
  [{live_mode:null},'payment_mode_missing'],
  [{live_mode:true},'payment_mode_true'],
  [{live_mode:'false'},'payment_mode_unexpected']
 ];
 for(const [patch,expected] of cases){
  const updated={...payment,...patch};
  const proof=verify({...base,payment:updated});
  const reasons=diagnosePaymentProofMismatch({intent,authorizedPayment,payment:updated});
  assert.equal(proof.ok,false);
  assert.equal(proof.code,'payment_not_verified');
  assert.ok(reasons.includes(expected),expected);
  assert.ok(reasons.every(x=>/^payment_[a-z_]+$/.test(x)));
  assert.ok(reasons.every(x=>!x.includes('9999')&&!x.includes('15001')));
 }
});
