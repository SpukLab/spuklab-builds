import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileDentrix,APP,BUYER,SELLER} from './mercadopago-dentrix-reconciliation.mjs';
function fixture(){
 const intent={stage:'linked',live_mode:false,collector_id:SELLER,currency_id:'ARS',amount_minor:100000,provider_subscription_id:'sub-test',external_reference:'cithela_test_ref'};
 const sub={id:'sub-test',external_reference:intent.external_reference,payer_id:BUYER,collector_id:SELLER,live_mode:false,application_id:APP,auto_recurring:{currency_id:'ARS',transaction_amount:1000}};
 const invoice={id:'123',preapproval_id:'sub-test',payment:{id:'456'}};
 const pay={id:'456',status:'approved',date_approved:'2026-11-28T00:57:31Z',currency_id:'ARS',transaction_amount:1000,collector_id:SELLER,payer:{id:BUYER},live_mode:true};
 const calls=[];
 const input={intent,buyerEmail:'buyer@example.invalid',eventPaymentId:'456',
  async getProvider(path){
   if(path==='/users/me')return {id:SELLER,site_id:'MLA',tags:['test_user']};
   if(path==='/users/'+BUYER)return {id:BUYER,site_id:'MLA'};
   if(path==='/preapproval/sub-test')return sub;
   if(path.startsWith('/authorized_payments/search?'))return {results:[invoice],paging:{total:1}};
   if(path==='/authorized_payments/123')return invoice;
   if(path==='/v1/payments/456')return pay;
   throw Error('unexpected read');
  },
  async commit(e){calls.push(e);return {ok:true,code:calls.length===1?'test_payment_reconciled':'already_reconciled'};}
 };
 return {input,sub,pay,invoice,calls};
}
test('signed event resource matches independently verified invoice and payment, never activates',async()=>{
 const f=fixture(),res=await reconcileDentrix(f.input);
 assert.equal(res.ok,true);assert.equal(res.entitlement_activated,false);
 assert.equal(f.calls[0].payment_id,'456');assert.equal(f.calls[0].invoice_id,'123');
 assert.equal((await reconcileDentrix(f.input)).code,'already_reconciled');
});
test('different resource does not reach persistence',async()=>{const f=fixture();f.input.eventPaymentId='789';assert.equal((await reconcileDentrix(f.input)).code,'different_payment');assert.equal(f.calls.length,0);});
test('wrong application, payer, amount or approval never persists',async()=>{
 const f=fixture();f.sub.application_id='wrong';await assert.rejects(()=>reconcileDentrix(f.input),/provider_application_mismatch/);assert.equal(f.calls.length,0);
 for(const change of [f=>f.pay.payer.id='other',f=>f.pay.transaction_amount=1,f=>f.pay.status='pending',f=>f.pay.live_mode=false]){
  const g=fixture();change(g);assert.equal((await reconcileDentrix(g.input)).ok,false);assert.equal(g.calls.length,0);
 }
});
test('no signed event in database means no successful reconciliation',async()=>{const f=fixture();f.input.commit=async()=>({ok:false,code:'signed_event_required'});assert.equal((await reconcileDentrix(f.input)).code,'signed_event_required');});
