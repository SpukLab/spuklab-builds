import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inspectMercadoPagoSubscription,prepareMercadoPagoCancellation} from './payments/mercadopago-reconciliation.mjs';

const accessToken='ONLY_FAKE_PRIVATE_TEST_TOKEN_0123456789';
const pid='PRE_APPROVAL_1234';
const ref='cithela_order_20261102_abcd';
const collector='200300400';
const amountMinor=1800000; // Test-only amount, NOT a proposed commercial price.
const date='2026-11-02T12:00:00.000Z';
const subscription={
 id:pid,collector_id:200300400,external_reference:ref,status:'authorized',
 auto_recurring:{frequency:1,frequency_type:'months',currency_id:'ARS',transaction_amount:'18000.00'}
};
const invoice={
 id:12345,preapproval_id:pid,external_reference:ref,
 currency_id:'ARS',transaction_amount:'18000.00',
 payment:{id:1234567,status:'approved',status_detail:'accredited'}
};
const payment={
 id:1234567,collector_id:200300400,external_reference:ref,
 status:'approved',status_detail:'accredited',date_approved:date,
 currency_id:'ARS',transaction_amount:18000
};

function setup(overrides={}){
 const current={
  subscription:{...subscription,...overrides.subscription},
  invoice:{...invoice,...overrides.invoice},
  payment:{...payment,...overrides.payment}
 };
 let calls=[];
 async function fetchImpl(url,options){
  calls.push({url,options});
  assert.equal(options.method,'GET','no purchase, cancellation or write allowed');
  assert.equal(options.headers.Authorization,'Bearer '+accessToken);
  assert.match(url,/^https:\/\/api\.mercadopago\.com\//);
  if(url.endsWith('/preapproval/'+pid))return Response.json(current.subscription);
  if(url.includes('/authorized_payments/search?'))return Response.json({
   paging:{total:overrides.total===undefined?1:overrides.total},
   results:overrides.results===undefined?[current.invoice]:overrides.results
  });
  if(url.endsWith('/v1/payments/1234567'))return Response.json(current.payment);
  throw Error('unexpected path '+url);
 }
 const expected={preapprovalId:pid,externalReference:ref,collectorId:collector,
   amountMinor,currency:'ARS',token:accessToken,fetchImpl};
 return {expected,calls};
}

test('valid provider records: subscription -> invoice -> actual approved payment',async()=>{
 const {expected,calls}=setup();
 const res=await inspectMercadoPagoSubscription(expected);
 assert.equal(res.ok,true);
 assert.equal(res.code,'confirmed_payment');
 assert.equal(res.verified_payment,true);
 assert.equal(res.provider_payment_id,'1234567');
 assert.equal(calls.length,3);
 assert.equal(calls.some(x=>x.options.method!=='GET'),false);
});
test('authorised subscription alone is NOT an approved payment',async()=>{
 for(const opts of [
  {subscription:{status:'pending'}},
  {invoice:{payment:{id:1234567,status:'pending',status_detail:'pending_waiting_payment'}}},
  {payment:{status:'authorized',status_detail:'pending_capture'}},
  {payment:{status:'refunded',status_detail:'refunded'}}
 ]){
  const {expected}=setup(opts);
  const res=await inspectMercadoPagoSubscription(expected);
  assert.notEqual(res.code,'confirmed_payment');
  assert.notEqual(res.verified_payment,true);
 }
});
test('wrong tenant reference, merchant, amount, currency, or frequency fail closed',async()=>{
 const cases=[
  {subscription:{external_reference:'other_tenant'}},
  {subscription:{collector_id:99999}},
  {subscription:{auto_recurring:{frequency:1,frequency_type:'months',currency_id:'USD',transaction_amount:18000}}},
  {subscription:{auto_recurring:{frequency:1,frequency_type:'days',currency_id:'ARS',transaction_amount:18000}}},
  {invoice:{external_reference:'other_tenant'}},
  {invoice:{transaction_amount:'18000.01'}},
  {payment:{collector_id:99999}},
  {payment:{transaction_amount:17999}},
  {payment:{external_reference:'other_tenant'}},
  {payment:{currency_id:'USD'}}
 ];
 for(const opts of cases){
  const {expected}=setup(opts);
  const result=await inspectMercadoPagoSubscription(expected);
  assert.equal(result.ok,false,JSON.stringify(opts));
  assert.notEqual(result.code,'confirmed_payment');
 }
});
test('invoice search pagination >20 fails closed for manual review',async()=>{
 const {expected}=setup({total:21});
 const res=await inspectMercadoPagoSubscription(expected);
 assert.deepEqual(res,{ok:false,code:'manual_review_required'});
});
test('provider outage never leaks secrets and never confirms payment',async()=>{
 const {expected}=setup();
 expected.fetchImpl=async()=>{throw Error('RAW SECRET '+accessToken)};
 const res=await inspectMercadoPagoSubscription(expected);
 assert.deepEqual(res,{ok:false,code:'provider_unavailable'});
 assert.doesNotMatch(JSON.stringify(res),/RAW SECRET|ONLY_FAKE_PRIVATE/);
});
test('invalid expected order returns denial without network calls',async()=>{
 const {expected,calls}=setup();
 for(const x of [
  {externalReference:'bad'}, {currency:'USD'},{amountMinor:0},
  {preapprovalId:'https://evil.example'},{collectorId:'x'}, {token:''}
 ]){
  const r=await inspectMercadoPagoSubscription({...expected,...x});
  assert.equal(r.code,'invalid_expected_order');
 }
 assert.equal(calls.length,0);
});
test('cancellation readiness performs read-only provider identity check',async()=>{
 const good=setup();
 assert.deepEqual(await prepareMercadoPagoCancellation(good.expected),
  {ok:true,code:'ready_for_explicit_confirmation',can_cancel:true});
 assert.equal(good.calls.length,1);
 const canceled=setup({subscription:{status:'cancelled'}});
 assert.deepEqual(await prepareMercadoPagoCancellation(canceled.expected),
  {ok:true,code:'already_canceled',can_cancel:false});
 const wrong=setup({subscription:{external_reference:'wrong_tenant'}});
 assert.equal((await prepareMercadoPagoCancellation(wrong.expected)).code,'subscription_identity_mismatch');
});
test('module has no billing writes, DB access, checkout or browser storage',()=>{
 const code=readFileSync(new URL('./payments/mercadopago-reconciliation.mjs',import.meta.url),'utf8');
 assert.match(code,/READ-ONLY/);
 assert.match(code,/providerGet\('\/preapproval\/'/);
 assert.match(code,/\/authorized_payments\/search\?preapproval_id=/);
 assert.match(code,/\/v1\/payments\//);
 assert.doesNotMatch(code,/'PUT'|'POST'|localStorage|service_role|\.update\(|\.insert\(|createCheckout|checkout\.mercadopago/i);
});
