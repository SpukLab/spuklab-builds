import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const TENANT="50b3e3eb-77a5-413d-af3b-9aa5b56e833e", EVENT="2903949d-f170-48c4-9273-2abad48a715d", DRAFT="¿Qué servicio necesitás?";
async function make({age=60,authorized=true,stale=false}={}){
 let handler, reserved=false;
 const calls=[];
 const env={SUPABASE_URL:"https://test.invalid",SUPABASE_SERVICE_ROLE_KEY:"secret-test",META_WHATSAPP_PHONE_NUMBER_ID:"phone-id",META_WHATSAPP_ACCESS_TOKEN:"test-only"};
 const Deno={env:{get:k=>env[k]},serve:fn=>{handler=fn;}};
 const db={
  auth:{getUser:async token=>token==="valid"?{data:{user:{id:"user-test"}},error:null}:{data:{},error:{message:"invalid"}}},
  from(table){
   const filters={};
   return {
    select(){return this;},eq(k,v){filters[k]=v;return this;},
    maybeSingle:async()=>{calls.push({kind:"read",table,filters:{...filters}});
     if(table==="cithela_tenant_memberships")return{data:authorized?{role:"owner"}:null,error:null};
     if(table==="cithela_tenants")return{data:{status:"active"},error:null};
     if(table==="cithela_channel_inbox")return{data:{id:EVENT,connection_id:"542ad49e-df0a-4833-bc95-773c1a5de364",message_type:"text",sender_phone_e164:"+5491123456789",provider_timestamp:new Date(Date.now()-age*60000).toISOString()},error:null};
     if(table==="cithela_channel_connections")return{data:{external_account_id:"phone-id"},error:null};
     throw Error(table);
    },
    insert(row){calls.push({kind:"insert",table,row});return{select(){return this;},single:async()=>reserved?{error:{code:"23505"}}:(reserved=true,{data:{id:"outbox"},error:null})};},
    update(row){calls.push({kind:"update",table,row});return{eq(){return this;},then(f){return Promise.resolve({error:null}).then(f);}};},
   };
  },
 };
 const src=await readFile(new URL("./index.ts",import.meta.url),"utf8");
 const clean=src.replace(/^import .*?;\s*$/m,"").replace("payload: unknown","payload").replace("providerTime: unknown","providerTime").replace("value: unknown","value").replace("let request: Record<string, unknown>","let request").replace("let preview: Record<string, unknown>","let preview").replace("let providerMessageId: string | null","let providerMessageId").replace("let errCode: string | null","let errCode");
 const fetcher=async url=>{
  if(String(url).includes("cithela-whatsapp-review")){calls.push({kind:"review"});return Response.json({ok:true,code:"needs_service",draft:stale?"outdated":DRAFT});}
  if(String(url).includes("graph.facebook.com")){calls.push({kind:"meta"});return Response.json({messages:[{id:"wamid.mock"}]});}
  throw Error("unexpected URL");
 };
 new Function("Deno","createClient","fetch",clean)(Deno,()=>db,fetcher);
 return {calls,async send(token="valid"){const resp=await handler(new Request("https://test.invalid",{method:"POST",headers:{"origin":"https://spuklab.github.io",authorization:"Bearer "+token,"content-type":"application/json"},body:JSON.stringify({action:"send",tenant_id:TENANT,event_id:EVENT,draft:DRAFT})}));return {status:resp.status,data:await resp.json()};}};
}
test("authentication and tenant authorization",async()=>{
 const bad=await make();assert.equal((await bad.send("bad")).status,401);assert.equal(bad.calls.length,0);
 const h=await make({authorized:false});assert.equal((await h.send()).status,403);assert.equal(h.calls.some(x=>x.table==="cithela_channel_inbox"),false);
});
test("expired service window and stale draft block provider",async()=>{
 const expired=await make({age:24*60});assert.equal((await expired.send()).data.code,"conversation_window_expired");assert.equal(expired.calls.some(x=>x.kind==="meta"),false);
 const stale=await make({stale:true});assert.equal((await stale.send()).data.code,"stale_or_unsupported_draft");assert.equal(stale.calls.some(x=>x.kind==="meta"),false);
});
test("valid approval sends only once even if repeated",async()=>{
 const h=await make();
 assert.equal((await h.send()).data.code,"submitted_to_meta");
 assert.equal((await h.send()).data.code,"already_attempted");
 assert.equal(h.calls.filter(x=>x.kind==="meta").length,1);
 assert.equal(h.calls.find(x=>x.kind==="update").row.status,"sent");
});
