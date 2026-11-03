import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {handleMercadoPagoWebhook} from './payments/mercadopago-webhook-handler.mjs';

const secret='mp_test_private_webhook_secret_2026_only';
const merchantUserId='123456789';
const headers={'content-type':'application/json'};
const sign=async(resourceId,requestId,ts='1783101234')=>{
  const text=new TextEncoder();
  const key=await crypto.subtle.importKey('raw',text.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const msg=`id:${resourceId};request-id:${requestId};ts:${ts};`;
  const raw=await crypto.subtle.sign('HMAC',key,text.encode(msg));
  return 'ts='+ts+',v1='+Array.from(new Uint8Array(raw),v=>v.toString(16).padStart(2,'0')).join('');
};
const makeBody=(overrides={})=>({
  id:'mp-event-123',type:'subscription_preapproval',data:{id:'resource-123'},
  user_id:123456789,live_mode:false,date_created:'2026-11-02T15:30:00Z',...overrides
});
async function incoming(body=makeBody(),options={}){
  const resourceId=options.resourceId??'resource-123';
  const requestId=options.requestId??'request-123';
  const type=options.type??'subscription_preapproval';
  const url='https://supabase.test/functions/v1/cithela-mercadopago-webhook?type='+
    type+'&data.id='+encodeURIComponent(resourceId);
  const signature=options.signature??await sign(resourceId,requestId);
  return new Request(url,{
    method:'POST',headers:{...headers,'x-request-id':requestId,'x-signature':signature},
    body:options.raw??JSON.stringify(body)
  });
}
const configure=(storeSignedEvent,overrides={})=>({
  enabled:true,secret,merchantUserId,liveMode:false,nowMs:1783101234*1000,storeSignedEvent,...overrides
});
const result=async(response)=>({status:response.status,...await response.json()});

test('valid provider-signed event is written once; duplicate delivery is acknowledged',async()=>{
  const inbox=new Map();
  const store=async(event)=>{
    if(inbox.has(event.eventId))return {ok:true,code:'duplicate'};
    inbox.set(event.eventId,event);return {ok:true,code:'recorded'};
  };
  const first=await result(await handleMercadoPagoWebhook(await incoming(),configure(store)));
  const second=await result(await handleMercadoPagoWebhook(await incoming(),configure(store)));
  assert.deepEqual(first,{status:200,ok:true,code:'recorded'});
  assert.deepEqual(second,{status:200,ok:true,code:'duplicate'});
  assert.equal(inbox.size,1);
  assert.deepEqual(Object.keys(inbox.get('mp-event-123')).sort(),
    ['eventId','liveMode','merchantUserId','occurredAt','requestId','resourceId','topic'].sort());
});

test('missing configuration blocks receiver BEFORE persistence',async()=>{
  let calls=0;
  const save=async()=>{calls++;return {ok:true,code:'recorded'};};
  const signed=await incoming();
  assert.equal((await result(await handleMercadoPagoWebhook(signed,configure(save,{enabled:false})))).status,503);
  assert.equal(calls,0);
  const noSecret=configure(save,{secret:''});
  assert.equal((await result(await handleMercadoPagoWebhook(await incoming(),noSecret))).status,503);
});

test('rejects altered signature, merchant, type, resource and environment',async()=>{
  let calls=0;
  const store=async()=>{calls++;return {ok:true,code:'recorded'};};
  const cases=[
    [makeBody(),{signature:'ts=1783101234,v1='+'0'.repeat(64)},401],
    [makeBody({user_id:99999}),{},403],
    [makeBody({type:'payment'}),{},403],
    [makeBody({data:{id:'another-resource'}}),{},403],
    [makeBody({live_mode:true}),{},403],
    [makeBody(),{type:'unknown_topic'},400]
  ];
  for(const [body,options,status] of cases){
    const r=await result(await handleMercadoPagoWebhook(await incoming(body,options),configure(store)));
    assert.equal(r.status,status,JSON.stringify(options));
  }
  assert.equal(calls,0);
});

test('provider retries on durable storage errors instead of incorrectly acknowledging',async()=>{
  const failing=async()=>{throw new Error('DB unavailable — must not expose in HTTP');};
  const r=await result(await handleMercadoPagoWebhook(await incoming(),configure(failing)));
  assert.deepEqual(r,{status:503,ok:false,code:'storage_unavailable'});
  assert.equal(JSON.stringify(r).includes('DB unavailable'),false);
});

test('event conflicts are not reported as valid duplicates',async()=>{
  const r=await result(await handleMercadoPagoWebhook(await incoming(),
    configure(async()=>({ok:false,code:'event_id_conflict'}))));
  assert.deepEqual(r,{status:409,ok:false,code:'event_conflict'});
});

test('malformed bodies, duplicate query keys and oversized requests are rejected',async()=>{
  const store=async()=>({ok:true,code:'recorded'});
  assert.equal((await result(await handleMercadoPagoWebhook(await incoming(makeBody(),{raw:'{bad'}),configure(store)))).status,400);
  const duplicate=await incoming();
  const url=duplicate.url+'&data.id=resource-123';
  const duplicated=new Request(url,{method:'POST',headers:duplicate.headers,body:JSON.stringify(makeBody())});
  assert.equal((await result(await handleMercadoPagoWebhook(duplicated,configure(store)))).status,401);
  const oversize=await incoming(makeBody({metadata:'X'.repeat(17000)}));
  assert.equal((await result(await handleMercadoPagoWebhook(oversize,configure(store)))).status,413);
});

test('non-POST requests are rejected before signature processing',async()=>{
  const req=new Request('https://supabase.test/functions/v1/cithela-mercadopago-webhook',{method:'GET'});
  assert.equal((await result(await handleMercadoPagoWebhook(req,configure(async()=>{})))).status,405);
});

test('design never turns a signed notification into a paid entitlement',()=>{
  const handler=readFileSync(new URL('./payments/mercadopago-webhook-handler.mjs',import.meta.url),'utf8');
  const edge=readFileSync(new URL('./edge/cithela-mercadopago-webhook/index.ts',import.meta.url),'utf8');
  const sql=readFileSync(new URL('./supabase/mercadopago-signed-webhook-inbox-20261102.sql',import.meta.url),'utf8');
  assert.match(handler,/verifyMercadoPagoSignature/);
  assert.match(edge,/CITHELA_MP_WEBHOOK_ENABLED/);
  assert.match(edge,/cithela_mp_record_signed_event/);
  assert.match(sql,/REVOKE ALL ON FUNCTION public.cithela_mp_record_signed_event/);
  assert.match(sql,/GRANT EXECUTE ON FUNCTION public.cithela_mp_record_signed_event/);
  assert.match(sql,/TO service_role/);
  assert.match(sql,/UNIQUE\(event_id\)/);
  assert.match(sql,/UNIQUE\(request_id,resource_id\)/);
  assert.doesNotMatch(handler,/fetch\(|service_role|activate|checkout|update\(/i);
  assert.doesNotMatch(sql,/UPDATE cithela_private.cithela_commercial_entitlements|INSERT INTO cithela_private.cithela_commercial_entitlements/i);
});

test('signed stale events cannot be replayed outside a five-minute window',async()=>{
  let calls=0;
  const store=async()=>{calls++;return {ok:true,code:'recorded'};};
  const old=await incoming();
  const resultOld=await result(await handleMercadoPagoWebhook(old,configure(store,{
    nowMs:1783101234*1000+5*60*1000+1000
  })));
  assert.deepEqual(resultOld,{status:401,ok:false,code:'signature_expired'});
  assert.equal(calls,0);
  const fresh=await incoming();
  const resultFresh=await result(await handleMercadoPagoWebhook(fresh,configure(store,{
    nowMs:1783101234*1000+4*60*1000
  })));
  assert.equal(resultFresh.status,200);
  assert.equal(calls,1);
});

test('staging receiver is fail-closed without config and permanently test-mode only',()=>{
  const source=readFileSync(new URL('./edge/cithela-mercadopago-webhook/index.ts',import.meta.url),'utf8');
  assert.match(source,/CITHELA_MP_WEBHOOK_ENABLED/);
  assert.match(source,/liveMode:false/);
  assert.match(source,/webhookSecret\.length>=16/);
  assert.match(source,/CITHELA_MP_MERCHANT_USER_ID/);
  assert.doesNotMatch(source,/CITHELA_MP_EXPECT_LIVE_MODE|liveMode:true/);
  assert.doesNotMatch(source,/\.from\(['"]cithela_commercial_entitlements/);
});

test('health reports only configured/not_configured without leaking credentials',async()=>{
  const url='https://supabase.test/functions/v1/cithela-mercadopago-webhook?health=1';
  const handler=async(config)=>result(await handleMercadoPagoWebhook(new Request(url,{method:'GET'}),config));
  assert.deepEqual(await handler(configure(async()=>{})),{status:200,ok:true,code:'webhook_configured'});
  const disabled=await handler(configure(async()=>{},{enabled:false}));
  assert.deepEqual(disabled,{status:503,ok:false,code:'not_configured'});
  assert.doesNotMatch(JSON.stringify(disabled),/mp_test_private|123456789|merchantUserId/);
});

test('HMAC-signed Mercado Pago panel simulation has a legacy inconsistent type and no merchant fields',async()=>{
  const seen=[];
  const body={
    action:'updated',application_id:'8696856635112318',
    data:{id:'123456'},date:'2021-11-01T02:02:02Z',
    entity:'preapproval',id:'123456',type:'subscription_preapproval',version:8
  };
  const req=await incoming(body,{
    resourceId:'123456',
    type:'subscription_authorized_payment',
    requestId:'simulator-request-001'
  });
  const reply=await result(await handleMercadoPagoWebhook(req,
    configure(async(event)=>{seen.push(event);return {ok:true,code:'recorded'}})));
  assert.deepEqual(reply,{status:200,ok:true,code:'recorded'});
  assert.equal(seen.length,1);
  assert.equal(seen[0].eventId,'sim_simulator-request-001');
  assert.equal(seen[0].topic,'subscription_preapproval');
  assert.equal(seen[0].resourceId,'123456');
  assert.equal(seen[0].merchantUserId,merchantUserId);
  assert.equal(seen[0].liveMode,false);
  assert.equal(seen[0].occurredAt,null);
});

test('legacy simulator allowance is narrow; unsigned or production events never enter inbox',async()=>{
  let count=0;
  const store=async()=>{count++;return {ok:true,code:'recorded'};};
  const base={
    action:'updated',application_id:'8696856635112318',
    data:{id:'123456'},date:'2021-11-01T02:02:02Z',
    entity:'preapproval',id:'123456',type:'subscription_preapproval',version:8
  };
  for(const [data,config,options,expected] of [
    [{...base,entity:'payment'},configure(store),{},403],
    [{...base,live_mode:true},configure(store),{},403],
    [{...base,user_id:123456789},configure(store),{},403],
    [{...base,action:'created'},configure(store),{},403],
    [base,configure(store,{liveMode:true}),{},403],
    [base,configure(store),{signature:'ts=1783101234,v1='+'0'.repeat(64)},401]
  ]){
    const req=await incoming(data,{resourceId:'123456',type:'subscription_authorized_payment',...options});
    const res=await result(await handleMercadoPagoWebhook(req,config));
    assert.equal(res.status,expected,JSON.stringify({data,expected}));
  }
  assert.equal(count,0);
});
