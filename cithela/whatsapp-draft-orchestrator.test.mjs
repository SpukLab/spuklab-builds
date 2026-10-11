import test from "node:test";
import assert from "node:assert/strict";
import { prepareInboundDraft } from "./whatsapp-draft-orchestrator.mjs";
const incoming={channel:"whatsapp",message_type:"text",external_event_id:"wamid.demo",tenant_id:"tenant",connection_id:"connection",text_body:"Quiero un turno para corte"};
function mock() {
  const calls=[];
  const responses={
    "catalog.services":{ok:true,items:[{id:"svc1",name:"Corte"}],timezone:"America/Argentina/Buenos_Aires"},
    "catalog.resources":{ok:true,items:[{id:"r1",name:"Profesional principal"}]},
    "availability.query":{ok:true,date:"2026-10-13",slots:["10:00","11:00","12:00","13:00"]}
  };
  return {calls, command:async (name,payload)=>{calls.push({name,payload});return responses[name];}};
}
test("drafts three provider slots only and never writes",async()=>{
 const api=mock();
 const result=await prepareInboundDraft(incoming,api,{dates:["2026-10-13"]});
 assert.equal(result.review_required,true);
 assert.equal(result.slots.length,3);
 assert.equal(result.send_enabled,false);
 assert.equal(result.booking_enabled,false);
 assert.deepEqual(api.calls.map(x=>x.name),["catalog.services","catalog.resources","availability.query"]);
});
test("unknown messages never call provider",async()=>{
 const api=mock();
 const result=await prepareInboundDraft({...incoming,text_body:"Hola"},api,{dates:["2026-10-13"]});
 assert.equal(result.status,"needs_review");assert.equal(api.calls.length,0);
});
test("no date window blocks automation",async()=>{
 const api=mock();
 const result=await prepareInboundDraft(incoming,api);
 assert.equal(result.reason,"date_window_required");
});
test("no guess when resources ambiguous",async()=>{
 const api=mock();const base=api.command;api.command=async(name,payload)=>name==="catalog.resources"?{ok:true,items:[{id:"a"},{id:"b"}]}:base(name,payload);
 const result=await prepareInboundDraft(incoming,api,{dates:["2026-10-13"]});
 assert.equal(result.reason,"resource_selection_required");
});
