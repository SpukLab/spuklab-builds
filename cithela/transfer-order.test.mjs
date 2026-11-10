import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {handleTransferOrder} from './payments/transfer-order-handler.mjs';

const uuid='b7246e31-621c-4228-9344-8a986b924318';
const ref='CIT-4BB70167298A31FE';
const url='https://mcqknmqhtmihegmifuka.supabase.co/functions/v1/cithela-transfer-orders';
const origin='https://spuklab.github.io';
const body={tenantId:uuid,consent:true,termsVersion:'cithela-billing-20261110'};
const ctx={
 enabled:true,alias:'alma.pampa',holder:'Titular bancario de prueba',
 resolveUser:async()=>({id:uuid,emailConfirmed:true}),
 prepareOrder:async()=>({
   ok:true,code:'transfer_order_pending',order_id:uuid,
   reference:ref,amount_minor:1500000,currency:'ARS',
   expires_at:'2026-11-14T00:00:00Z',paid:false
 })
};
const req=(payload=body,options={})=>new Request(url,{
 method:options.method||'POST',
 headers:{origin,Authorization:'Bearer test-user',...options.headers},
 body:options.method==='GET'?undefined:JSON.stringify(payload)
});
const read=async response=>({status:response.status,body:await response.json()});

test('no pending request when unpublished / feature flag off',async()=>{
 const r=await read(await handleTransferOrder(req(),{...ctx,enabled:false}));
 assert.equal(r.status,503);
 assert.equal(r.body.code,'transfer_not_enabled');
});
test('CORS, method and bearer fail closed',async()=>{
 assert.equal((await read(await handleTransferOrder(req(body,{headers:{origin:'https://evil.example'}}),ctx))).status,403);
 assert.equal((await read(await handleTransferOrder(req(body,{method:'GET'}),ctx))).status,405);
 assert.equal((await read(await handleTransferOrder(req(body,{headers:{authorization:''}}),ctx))).status,401);
});
test('no amounts, owner identity or free access chosen by browser',async()=>{
 for(const payload of [
   {...body,amount_minor:100},
   {...body,ownerUserId:uuid},
   {...body,consent:false},
   {...body,termsVersion:'forged-v1'},
   {...body,tenantId:'../../tenant'}
 ]){
   const result=await read(await handleTransferOrder(req(payload),ctx));
   assert.equal(result.status,400);
 }
});
test('email and owner membership are server-validated',async()=>{
 const a=await read(await handleTransferOrder(req(),{...ctx,
   resolveUser:async()=>({id:uuid,emailConfirmed:false})}));
 assert.equal(a.status,403);
 const b=await read(await handleTransferOrder(req(),{...ctx,
   prepareOrder:async()=>({ok:false,code:'not_owner'})}));
 assert.equal(b.status,403);
 const c=await read(await handleTransferOrder(req(),{...ctx,
   prepareOrder:async()=>({ok:false,code:'offer_not_published'})}));
 assert.equal(c.status,503);
});
test('pending transfer response is explicitly not a credited payment',async()=>{
 const r=await read(await handleTransferOrder(req(),ctx));
 assert.equal(r.status,200);
 assert.equal(r.body.transfer_alias,'alma.pampa');
 assert.equal(r.body.amount_minor,1500000);
 assert.equal(r.body.status,'pending');
 assert.equal(r.body.credited,false);
 assert.equal(r.body.code,'transfer_order_pending');
 assert.doesNotMatch(JSON.stringify(r.body),/provider_subscription_id|access_token|service_role/i);
});
test('never accepts paid status from untrusted DB response',async()=>{
 const r=await read(await handleTransferOrder(req(),{...ctx,
   prepareOrder:async()=>({...await ctx.prepareOrder(),paid:true})}));
 assert.equal(r.status,503);
 assert.equal(r.body.code,'order_unavailable');
});
test('SQL is staged, private, and cannot activate a subscription',()=>{
 const sql=readFileSync(new URL('supabase/cithela_transfer_orders_staged_20261110.sql',import.meta.url),'utf8');
 assert.match(sql,/CHECK \(is_published=false\)/);
 assert.match(sql,/CHECK \(status<>'credited'\)/);
 assert.match(sql,/REVOKE ALL ON FUNCTION public\.cithela_prepare_transfer_order/);
 assert.match(sql,/TO service_role/);
 assert.doesNotMatch(sql,/UPDATE\s+cithela_private\.cithela_commercial_entitlements/i);
});
