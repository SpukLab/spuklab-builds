import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const TENANT="50b3e3eb-77a5-413d-af3b-9aa5b56e833e", EVENT="2903949d-f170-48c4-9273-2abad48a715d", DRAFT="¿Qué servicio necesitás?";
async function make({age=60,authorized=true,stale=false,metaCode=null,senderId="phone-id",recipient="+5491123456789"}={}){
 let handler, reserved=false;
 const calls=[];
 const env={SUPABASE_URL:"https://test.invalid",SUPABASE_SERVICE_ROLE_KEY:"secret-test",META_WHATSAPP_PHONE_NUMBER_ID:senderId,META_WHATSAPP_ACCESS_TOKEN:"test-only"};
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
     if(table==="cithela_channel_inbox")return{data:{id:EVENT,connection_id:"542ad49e-df0a-4833-bc95-773c1a5de364",message_type:"text",sender_phone_e164:recipient,provider_timestamp:new Date(Date.now()-age*60000).toISOString()},error:null};
     if(table==="cithela_channel_connections")return{data:{external_account_id:senderId},error:null};
     throw Error(table);
    },
    insert(row){calls.push({kind:"insert",table,row});return{select(){return this;},single:async()=>reserved?{error:{code:"23505"}}:(reserved=true,{data:{id:"outbox"},error:null})};},
    update(row){calls.push({kind:"update",table,row});return{eq(){return this;},then(f){return Promise.resolve({error:null}).then(f);}};},
   };
  },
 };
 const src=await readFile(new URL("./index.ts",import.meta.url),"utf8");
 const clean=src.replace(/^import .*?;\s*$/m,"").replace("Deno.serve(async (req: Request)","Deno.serve(async (req)").replace("payload: unknown","payload").replace("providerTime: unknown","providerTime").replace("value: unknown","value").replace("let request: Record<string, unknown>","let request").replace("let preview: Record<string, unknown>","let preview").replace("let providerMessageId: string | null","let providerMessageId").replace("let errCode: string | null","let errCode").replace("function metaRecipient(to: string, senderId: string)","function metaRecipient(to, senderId)");
 const fetcher=async (url,opts)=>{
  if(String(url).includes("fields=id,display_phone_number,quality_rating")){
    calls.push({kind:"meta_read",method:opts.method});
    return metaCode?Response.json({error:{code:metaCode}},{status:403}):
      Response.json({id:senderId,display_phone_number:"+1 555-645-6422",quality_rating:"GREEN"});
  }
  if(String(url).includes("cithela-whatsapp-review")){calls.push({kind:"review"});return Response.json({ok:true,code:"needs_service",draft:stale?"outdated":DRAFT});}
  if(String(url).includes("graph.facebook.com")){calls.push({kind:"meta",to:JSON.parse(opts.body).to});return metaCode?Response.json({error:{code:metaCode,message:"REDACTED"}},{status:400}):Response.json({messages:[{id:"wamid.mock"}]});}
  throw Error("unexpected URL");
 };
 new Function("Deno","createClient","fetch",clean)(Deno,()=>db,fetcher);
 return {calls,async send(token="valid",payload=null){const resp=await handler(new Request("https://test.invalid",{method:"POST",headers:{"origin":"https://spuklab.github.io",authorization:"Bearer "+token,"content-type":"application/json"},body:JSON.stringify(payload||{action:"send",tenant_id:TENANT,event_id:EVENT,draft:DRAFT})}));return {status:resp.status,data:await resp.json()};}};
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

test("test-recipient rejection retains Meta code without resending",async()=>{
 const h=await make({metaCode:131030});
 const result=await h.send();
 assert.equal(result.status,502);
 assert.equal(result.data.code,"test_recipient_not_allowed");
 assert.equal(result.data.diagnostic_code,"meta_code_131030");
 assert.equal(h.calls.find(x=>x.kind==="update").row.error_code,"meta_code_131030");
 assert.equal(h.calls.filter(x=>x.kind==="meta").length,1);
 assert.equal((await h.send()).data.code,"already_attempted");
 assert.equal(h.calls.filter(x=>x.kind==="meta").length,1);
});

test("Meta test sender omits Argentine 9, keeping patient phone unchanged",async()=>{
 const h=await make({senderId:"1300517359820775",recipient:"+5491123456789"});
 const res=await h.send();
 assert.equal(res.data.code,"submitted_to_meta");
 assert.equal(h.calls.find(x=>x.kind==="meta").to,"541123456789");
 assert.equal(h.calls.find(x=>x.table==="cithela_channel_inbox").kind,"read");
});
test("production sender keeps canonical WhatsApp Argentine ID",async()=>{
 const h=await make({senderId:"production-phone-id",recipient:"+5491123456789"});
 const res=await h.send();
 assert.equal(res.data.code,"submitted_to_meta");
 assert.equal(h.calls.find(x=>x.kind==="meta").to,"5491123456789");
});
test("test sender does not rewrite numbers outside Argentine mobile format",async()=>{
 const h=await make({senderId:"1300517359820775",recipient:"+12025550123"});
 assert.equal((await h.send()).data.code,"submitted_to_meta");
 assert.equal(h.calls.find(x=>x.kind==="meta").to,"12025550123");
});

test("Meta access denied 131005 is actionable and never retried",async()=>{
 const h=await make({metaCode:131005});
 const first=await h.send();
 assert.equal(first.status,502);
 assert.equal(first.data.code,"meta_access_denied");
 assert.equal(first.data.diagnostic_code,"meta_code_131005");
 assert.equal(h.calls.find(x=>x.kind==="update").row.error_code,"meta_code_131005");
 const again=await h.send();
 assert.equal(again.data.code,"already_attempted");
 assert.equal(h.calls.filter(x=>x.kind==="meta").length,1);
});

test("read-only Meta credentials check uses Supabase token and never sends",async()=>{
 const h=await make();
 const result=await h.send("valid",{action:"check_credentials",tenant_id:TENANT});
 assert.equal(result.status,200);
 assert.equal(result.data.code,"meta_number_accessible");
 assert.equal(result.data.quality_rating,"GREEN");
 assert.equal(h.calls.filter(x=>x.kind==="meta_read").length,1);
 assert.equal(h.calls.filter(x=>x.kind==="meta").length,0);
 assert.equal(h.calls.some(x=>x.kind==="insert"||x.kind==="update"),false);
 assert.equal(h.calls.some(x=>x.table==="cithela_channel_inbox"),false);
});
test("only admins can check token access to their active WhatsApp connection",async()=>{
 const h=await make({authorized:false});
 const result=await h.send("valid",{action:"check_credentials",tenant_id:TENANT});
 assert.equal(result.status,403);
 assert.equal(h.calls.some(x=>x.kind==="meta_read"),false);
});
test("Meta rejected token returns numeric code without exposing credentials",async()=>{
 const h=await make({metaCode:190});
 const result=await h.send("valid",{action:"check_credentials",tenant_id:TENANT});
 assert.equal(result.status,502);
 assert.equal(result.data.code,"meta_credential_check_failed");
 assert.equal(result.data.diagnostic_code,"meta_code_190");
 assert.equal(h.calls.filter(x=>x.kind==="meta").length,0);
 assert.equal(h.calls.filter(x=>x.kind==="meta_read").length,1);
});

test("Meta diagnostic redacts tokens, patient phone, email, and URL before logging", async () => {
 const src=await readFile(new URL("./index.ts",import.meta.url),"utf8");
 const clean=src.replace(/^import .*?;\s*$/m,"")
  .replace("Deno.serve(async (req: Request)","Deno.serve(async (req)")
  .replace("payload: unknown","payload")
  .replace("providerTime: unknown","providerTime")
  .replace("value: unknown","value")
  .replace("let request: Record<string, unknown>","let request")
  .replace("let preview: Record<string, unknown>","let preview")
  .replace("let providerMessageId: string | null","let providerMessageId")
  .replace("let errCode: string | null","let errCode")
  .replace("function metaRecipient(to: string, senderId: string)","function metaRecipient(to, senderId)");
 const sanitize=new Function("Deno","createClient","fetch",clean+"\nreturn diagnosticMetaText;")
  ({env:{get:()=>null},serve:()=>{}},()=>({}),()=>{});
 const unsafe="Denied for +5492212345678 and user@example.com at https://example.com?key=secret EAA12345678901234567890";
 const result=sanitize(unsafe);
 assert.ok(typeof result==="string");
 for(const secret of ["+5492212345678","user@example.com","https://example.com","EAA12345678901234567890"])
  assert.equal(result.includes(secret),false,secret);
 assert.ok(result.includes("Denied"));
});

