import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html=readFileSync(new URL("./index.html",import.meta.url),"utf8");
const beginning=html.indexOf("let cloudWaBusy=false;");
const ending=html.indexOf("async function cloudPrepareWhatsappDraft(eventId){",beginning);
assert.ok(beginning>=0&&ending>beginning,"Inbox source section present");
const source=html.slice(beginning,ending);
const first="00000000-0000-4000-8000-000000000001";
const second="00000000-0000-4000-8000-000000000002";
const tenant="00000000-0000-4000-8000-000000000003";

function harness(){
  const list={rows:[],_text:"",get firstChild(){return this.rows[0]||null;},
    get textContent(){return this._text;},
    set textContent(value){this._text=value;this.rows=[];},
    insertBefore(row){this.rows.unshift(row);},
    querySelector(){return this.rows[0]||null;},
    querySelectorAll(){return [...this.rows];}};
  const status={textContent:""};
  const counts={textContent:""};
  const panel={open:true,style:{display:"block"},listeners:{},
    addEventListener(event,fn){this.listeners[event]=fn;}};
  const pane={visible:true,classList:{contains(name){return name==="on"&&pane.visible;}}};
  const nav={textContent:"Mensajes",ariaLabel:"",setAttribute(key,val){if(key==="aria-label")this.ariaLabel=val;}};
  const elements={"cloud-wa-list":list,"cloud-wa-counts":counts,
    "cloud-wa-live-status":status,"cloud-wa-pilot":panel,
    "p-medico-mensajes":pane,"cloud-wa-tab":nav};
  const makeRow=(id)=>({id,open:false,hidden:false,style:{},
    replaceWith(next){const index=list.rows.indexOf(this);if(index>=0)list.rows[index]=next;},
    remove(){list.rows=list.rows.filter(x=>x!==this);}});
  const document={
    visibilityState:"visible",
    createElement(){return {firstElementChild:null,set innerHTML(value){
      const match=/id="(cloud-wa-event-[0-9a-f-]{36})"/.exec(value);
      this.firstElementChild=match?makeRow(match[1]):null;
    }};},
    querySelectorAll(){return list.rows;},
    addEventListener(){},
  };
  const intervals=[];
  const window={setInterval(fn,ms){intervals.push({fn,ms});},addEventListener(){}};
  let items=[],reviewCalls=0;
  const state={signedIn:true,tenant:{id:tenant},membership:{role:"owner"}};
  const CithelaCloud={state:()=>state,
    async whatsappReview(payload){
      assert.equal(payload.action,"list");
      assert.equal(payload.tenant_id,tenant);
      reviewCalls++;
      return {items:structuredClone(items)};
    }};
  const context={document,window,CithelaCloud,escHtml:x=>x,
    $:id=>elements[id]||list.rows.find(row=>row.id===id)||null};
  vm.runInNewContext(source+`
    globalThis.api={
      load:cloudLoadWhatsappInbox,
      install:installCloudWaInboxPolling,
      getDraft:()=>cloudWaPendingDraft,
      setDraft:x=>{cloudWaPendingDraft=x;},
      tick:()=>installCloudWaInboxPolling()
    };
  `,context);
  return {
    api:context.api,state,list,counts,status,panel,pane,nav,document,intervals,
    setItems(value){items=value;},get reviewCalls(){return reviewCalls;}
  };
}
const item=(id,received_at,outbound=null)=>({
  id,received_at,text_body:"Quiero turno",sender_name:"Demo",outbound
});

test("polling adds incoming messages without closing a draft card or dropping its field",async()=>{
  const h=harness();
  h.setItems([item(first,"2026-10-27T13:00:00Z")]);
  await h.api.load();
  const opened=h.list.rows[0];
  opened.open=true;
  h.api.setDraft({event_id:first,draft:"Respuesta protegida"});
  const note={value:"Indicacion en curso"};
  // The row is reused (the underlying textarea would remain mounted in the browser).
  opened.note=note;
  h.setItems([item(second,"2026-10-27T13:05:00Z"),item(first,"2026-10-27T13:00:00Z")]);
  await h.api.load(null,true);
  assert.equal(h.list.rows.length,2);
  assert.equal(h.list.rows[0].id,"cloud-wa-event-"+second);
  assert.equal(h.list.rows[1],opened);
  assert.equal(opened.open,true);
  assert.equal(opened.note.value,"Indicacion en curso");
  assert.equal(h.api.getDraft().draft,"Respuesta protegida");
  assert.match(h.counts.textContent,/Sin responder: 2/);
  assert.equal(h.nav.textContent,"Mensajes (2)");
  assert.match(h.nav.ariaLabel,/últimos 2/);
});
test("server response status transitions replace only the affected card",async()=>{
  const h=harness();
  h.setItems([item(first,"2026-10-27T13:00:00Z"),item(second,"2026-10-27T12:00:00Z")]);
  await h.api.load();
  const firstRow=h.list.rows[0],secondRow=h.list.rows[1];
  firstRow.open=true;
  h.setItems([item(first,"2026-10-27T13:00:00Z",{status:"sent",reply_text:"OK"}),
    item(second,"2026-10-27T12:00:00Z")]);
  await h.api.load(null,true);
  assert.notEqual(h.list.rows[0],firstRow);
  assert.equal(h.list.rows[0].open,true);
  assert.equal(h.list.rows[1],secondRow);
  assert.match(h.counts.textContent,/Meta aceptó: 1/);
});
test("polling refreshes only while the messages tab is visible",async()=>{
  const h=harness();
  h.api.install();
  assert.equal(h.intervals.length,1);
  h.pane.visible=false;
  h.intervals[0].fn();
  assert.equal(h.reviewCalls,0,"hidden page must not poll");
  h.pane.visible=true;
  h.intervals[0].fn();
  assert.equal(h.reviewCalls,1,"messages page must poll when shown");
});
test("polling pauses while hidden, closed or unauthenticated",async()=>{
  const h=harness();
  h.api.install();
  assert.equal(h.intervals.length,1);
  assert.equal(h.intervals[0].ms,20000);
  h.document.visibilityState="hidden";
  h.intervals[0].fn();
  h.document.visibilityState="visible";h.panel.open=false;
  h.intervals[0].fn();
  h.panel.open=true;h.state.signedIn=false;
  h.intervals[0].fn();
  assert.equal(h.reviewCalls,0);
});

test("WhatsApp inbox lives in its own professional tab, not hidden in cloud configuration",()=>{
  const index=html.indexOf('id="p-medico-mensajes"');
  const settings=html.indexOf('id="cfg-section-cloud"');
  assert.ok(index>0&&settings>0);
  assert.ok(html.indexOf('id="cloud-wa-pilot"',index)>index,"inbox must be in messages pane");
  assert.ok(html.indexOf('id="cloud-wa-pilot"',settings)<0||html.indexOf('id="cloud-wa-pilot"',settings)>index,
    "inbox should not be nested inside cloud configuration");
  assert.match(html,/id="cloud-wa-tab"[^>]*onclick="tab\('medico','mensajes',this\)"/);
  assert.match(html,/if\(sc==='medico'&&id==='mensajes'\)/);
  assert.match(html,/waTab\.style\.display=canUseWa\?'block':'none'/);
});
