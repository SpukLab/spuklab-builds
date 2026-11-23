import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {handleMercadoPagoWebhook} from './mercadopago-webhook-handler.mjs';

const SECRET='test-secret-value-123456789000';
const MERCHANT='3813812326';
const REQUEST_ID='req-test-1234';
const RESOURCE_ID='123456789';
function makeRequest(changes={}){
 const body={
  id:222444666,type:'subscription_authorized_payment',
  data:{id:RESOURCE_ID},user_id:MERCHANT,live_mode:false,
  date_created:'2026-11-23T03:27:00Z',...changes
 };
 const ts=String(Math.floor(Date.now()/1000));
 const message=`id:${RESOURCE_ID};request-id:${REQUEST_ID};ts:${ts};`;
 const mac=createHmac('sha256',SECRET).update(message).digest('hex');
 const url='https://example.supabase.co/functions/v1/cithela-mercadopago-webhook?data.id='+RESOURCE_ID+'&type=subscription_authorized_payment';
 return new Request(url,{method:'POST',headers:{'x-request-id':REQUEST_ID,'x-signature':`ts=${ts},v1=${mac}`,'content-type':'application/json'},body:JSON.stringify(body)});
}
function setup(){
 const reasons=[],stored=[];
 const config={
  enabled:true,secret:SECRET,merchantUserId:MERCHANT,liveMode:false,
  reportValidationFailure(code){reasons.push(code)},
  async storeSignedEvent(event){stored.push(event);return {ok:true,code:'recorded'}}
 };
 return {reasons,stored,config};
}
test('valid signed test event is durably accepted',async()=>{
 const t=setup();
 const r=await handleMercadoPagoWebhook(makeRequest(),t.config);
 assert.equal(r.status,200);
 assert.deepEqual(t.reasons,[]);
 assert.equal(t.stored.length,1);
});
test('signed real-mode notification is rejected with metadata-only reason',async()=>{
 const t=setup();
 const r=await handleMercadoPagoWebhook(makeRequest({live_mode:true}),t.config);
 assert.equal(r.status,403);
 assert.deepEqual(t.reasons,['provider_mode_true']);
 assert.equal(t.stored.length,0);
 assert.doesNotMatch(t.reasons.join(' '),/3813812326|123456789|secret|req-test/);
});
test('missing live_mode cannot silently become a test event',async()=>{
 const t=setup(),body={id:42,type:'subscription_authorized_payment',
   data:{id:RESOURCE_ID},user_id:MERCHANT};
 const request=makeRequest(body); // override does not remove original
 const altered=makeRequest({live_mode:null});
 const r=await handleMercadoPagoWebhook(altered,t.config);
 assert.equal(r.status,403);
 assert.deepEqual(t.reasons,['provider_mode_unavailable']);
 assert.equal(t.stored.length,0);
});
test('signed merchant and type mismatches are classified without IDs',async()=>{
 for(const [change,expected] of [
   [{user_id:'55555'},'merchant_mismatch'],
   [{type:'payment'},'topic_mismatch'],
   [{data:{id:'9999'}},'resource_mismatch']
 ]){
  const t=setup();
  const r=await handleMercadoPagoWebhook(makeRequest(change),t.config);
  assert.equal(r.status,403);
  assert.deepEqual(t.reasons,[expected]);
  assert.equal(t.stored.length,0);
 }
});
test('tampered signature is still rejected before mismatch classification',async()=>{
 const t=setup();
 const req=makeRequest({live_mode:true});
 const tampered=new Request(req,{headers:{...Object.fromEntries(req.headers),
   'x-signature':'ts=1111111111,v1='+'0'.repeat(64)}});
 const r=await handleMercadoPagoWebhook(tampered,t.config);
 assert.equal(r.status,401);
 assert.deepEqual(t.reasons,['invalid_signature']);
 assert.equal(t.stored.length,0);
});

test('signed payment event with missing top-level id is accepted with stable derived id',async()=>{
 const t=setup();
 const r=await handleMercadoPagoWebhook(makeRequest({id:undefined}),t.config);
 assert.equal(r.status,200);
 assert.equal(t.stored.length,1);
 assert.match(t.stored[0].eventId,/^signed_[0-9a-f]{64}$/);
 assert.deepEqual(t.reasons,[]);
});
test('repeated signed event without top-level id maps to same id for deduplication',async()=>{
 const t=setup();
 const a=await handleMercadoPagoWebhook(makeRequest({id:undefined}),t.config);
 const b=await handleMercadoPagoWebhook(makeRequest({id:undefined}),t.config);
 assert.equal(a.status,200);assert.equal(b.status,200);
 assert.equal(t.stored[0].eventId,t.stored[1].eventId);
});
test('missing top-level id never bypasses merchant, mode or type validation',async()=>{
 for(const [change,expected] of [
  [{id:undefined,live_mode:true},'provider_mode_true'],
  [{id:undefined,user_id:'1000'},'merchant_mismatch'],
  [{id:undefined,type:'payment'},'topic_mismatch'],
  [{id:undefined,data:{id:'9999'}},'resource_mismatch']
 ]){
  const t=setup();
  const r=await handleMercadoPagoWebhook(makeRequest(change),t.config);
  assert.equal(r.status,403);assert.deepEqual(t.reasons,[expected]);
  assert.equal(t.stored.length,0);
 }
});
test('explicit malicious top-level event id is still rejected',async()=>{
 const t=setup();
 const r=await handleMercadoPagoWebhook(makeRequest({id:{invalid:true}}),t.config);
 assert.equal(r.status,403);
 assert.deepEqual(t.reasons,['event_id_invalid']);
 assert.equal(t.stored.length,0);
});

test('provider event with noncanonical primitive top-level id still deduplicates by signed resource',async()=>{
 const ids=[null,'abcdef/987','123.456.789',-4,12.25,Number.MAX_SAFE_INTEGER+12];
 let previous=null;
 for(const id of ids){
  const scope=setup();
  const response=await handleMercadoPagoWebhook(makeRequest({id}),scope.config);
  assert.equal(response.status,200,'value '+String(id));
  assert.equal(scope.stored.length,1);
  assert.match(scope.stored[0].eventId,/^signed_[a-f0-9]{64}$/);
  if(previous!==null)assert.equal(scope.stored[0].eventId,previous);
  previous=scope.stored[0].eventId;
 }
});
test('same authorized payment ID from real signed topic is not confused with a different topic',async()=>{
 const scope=setup();
 await handleMercadoPagoWebhook(makeRequest({id:null}),scope.config);
 const allowed=scope.stored[0].eventId;
 // Forged topic is still rejected and never persisted.
 const t2=setup();
 const result=await handleMercadoPagoWebhook(makeRequest({id:null,type:'payment'}),t2.config);
 assert.equal(result.status,403);
 assert.equal(t2.stored.length,0);
 assert.equal(scope.stored[0].eventId,allowed);
});
