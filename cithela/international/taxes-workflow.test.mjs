import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  TAX_YEAR, DEMO_YEAR,createDemoTaxCase,advanceDemoTaxCase,markGeneralGuideShared,
  getTaxOverview,getTaxLabels,getPublicPreparationGuide,
  neutralAppointmentMessage,formatUtahAppointment
} from './taxes-workflow.mjs';

const args={
  caseId:'demo-case-a',serviceId:'tax-2026',
  appointmentAt:'2027-01-20T17:00:00Z',now:'2026-11-23T15:00:00Z',role:'admin'
};
const sample=()=>createDemoTaxCase(args);

test('pilot is fixed to 2026 returns and 2027 appointments',()=>{
  assert.equal(TAX_YEAR,2026);
  assert.equal(DEMO_YEAR,2027);
  assert.equal(sample().stage,'contacted');
  assert.equal(sample().revision,1);
  assert.equal(sample().guideShared,false);
});

test('only approved administrative fields are accepted; no financial or identity fields',()=>{
  assert.throws(()=>createDemoTaxCase({...args,ssn:'111-11-1111'}),/unapproved_field/);
  assert.throws(()=>createDemoTaxCase({...args,clientName:'Fake Name'}),/unapproved_field/);
  assert.throws(()=>createDemoTaxCase({...args,documentTypes:['W-2']}),/unapproved_field/);
  assert.throws(()=>createDemoTaxCase({...args,bankAccount:'x'}),/unapproved_field/);
  assert.throws(()=>createDemoTaxCase({...args,notes:'income'}),/unapproved_field/);
  const record=sample();
  assert.deepEqual(Object.keys(record),['caseId','serviceId','appointmentAt','stage','guideShared','revision']);
  assert.doesNotMatch(JSON.stringify(record),/ssn|w-2|name|1099|bank|income/i);
});

test('rejects non-tax services, undefined roles, non-demo cases and other years',()=>{
  assert.throws(()=>createDemoTaxCase({...args,serviceId:'auto-quote'}),/invalid_service/);
  assert.throws(()=>createDemoTaxCase({...args,role:'viewer'}),/forbidden/);
  assert.throws(()=>createDemoTaxCase({...args,role:'patient'}),/forbidden/);
  assert.throws(()=>createDemoTaxCase({...args,caseId:'person@example.com'}),/invalid_case_id/);
  assert.throws(()=>createDemoTaxCase({...args,appointmentAt:'2026-12-24T17:00:00Z'}),/invalid_pilot_year/);
  assert.throws(()=>createDemoTaxCase({...args,appointmentAt:'tomorrow'}),/invalid_date/);
});

test('stages advance sequentially with version checks and stop at completed',()=>{
  let c=sample();
  for(const stage of ['scheduled','documents_pending','ready_for_preparer','completed']){
    const previous=c;
    c=advanceDemoTaxCase(c,{role:'operator',expectedRevision:c.revision});
    assert.equal(c.stage,stage);
    assert.equal(c.revision,previous.revision+1);
    assert.equal(previous.stage===stage,false);
  }
  assert.throws(()=>advanceDemoTaxCase(c,{role:'admin',expectedRevision:c.revision}),/already_completed/);
  assert.throws(()=>advanceDemoTaxCase(sample(),{role:'viewer',expectedRevision:1}),/forbidden/);
  assert.throws(()=>advanceDemoTaxCase(sample(),{role:'admin',expectedRevision:2}),/stale_write/);
});

test('guide shared is a single generic flag, idempotent and versioned',()=>{
  const c=sample();
  const first=markGeneralGuideShared(c,{role:'owner',expectedRevision:1});
  assert.equal(first.replayed,false);
  assert.equal(first.case.guideShared,true);
  assert.equal(first.case.revision,2);
  assert.equal(c.guideShared,false);
  const repeated=markGeneralGuideShared(first.case,{role:'owner',expectedRevision:2});
  assert.equal(repeated.replayed,true);
  assert.equal(repeated.case.revision,2);
  assert.throws(()=>markGeneralGuideShared(c,{role:'patient',expectedRevision:1}),/forbidden/);
  assert.throws(()=>markGeneralGuideShared(first.case,{role:'admin',expectedRevision:1}),/stale_write/);
});

test('metrics reflect stages, no taxpayer details',()=>{
  let c=sample();
  const a=c;
  c=advanceDemoTaxCase(c,{role:'admin',expectedRevision:1});
  let b={...c,caseId:'demo-case-b'};
  b=advanceDemoTaxCase(b,{role:'admin',expectedRevision:b.revision});
  const summary=getTaxOverview([a,b]);
  assert.deepEqual(summary,{total:2,active:2,ready:0,pending:1,finished:0});
  assert.throws(()=>getTaxOverview({}),/invalid_cases/);
});

test('bilingual guidance is informational and never asks to upload',()=>{
  const en=getPublicPreparationGuide({serviceId:'tax-2026',locale:'en'});
  const es=getPublicPreparationGuide({serviceId:'tax-2026',locale:'es'});
  assert.equal(en.collectionEnabled,false);
  assert.equal(es.collectionEnabled,false);
  assert.ok(en.items.some(x=>x.includes('W-2')));
  assert.ok(es.items.some(x=>x.includes('1099')));
  assert.match(en.disclaimer,/Do not upload/i);
  assert.match(es.disclaimer,/No subas/i);
  assert.throws(()=>getPublicPreparationGuide({serviceId:'home-quote'}),/invalid_service/);
  assert.equal(getTaxLabels('es').stages.find(s=>s.key==='completed').label,'Finalizado');
  assert.equal(getTaxLabels('en').stages.find(s=>s.key==='completed').label,'Completed');
});

test('neutral messages do not name tax services, income, or sensitive document types',()=>{
  for(const language of ['en','es']){
    const text=neutralAppointmentMessage(language);
    assert.ok(text.length>40);
    assert.doesNotMatch(text,/tax|impuest|w-2|1099|1095|ssn|itin|credit|refund|reintegr|ingreso/i);
  }
});
test('appointment display uses America/Denver DST (winter/summer)',()=>{
  assert.match(formatUtahAppointment('2027-01-20T17:00:00Z','en'),/10:00 AM/);
  assert.match(formatUtahAppointment('2027-07-20T16:00:00Z','en'),/10:00 AM/);
});

test('preview is isolated, uses no client identifiers or backend',()=>{
  const html=readFileSync(new URL('./taxes-preview.html',import.meta.url),'utf8');
  const view=readFileSync(new URL('./taxes-preview.mjs',import.meta.url),'utf8');
  const model=readFileSync(new URL('./taxes-workflow.mjs',import.meta.url),'utf8');
  assert.match(html,/Demo \/ simulación/);
  assert.match(html,/nothing is sent|Nothing is sent/i);
  assert.match(html,/taxes-preview\.mjs/);
  assert.match(view,/createDemoTaxCase/);
  assert.match(view,/getPublicPreparationGuide/);
  assert.match(view,/neutralAppointmentMessage/);
  assert.doesNotMatch(view,/innerHTML|document\.write|insertAdjacentHTML|outerHTML/);
  for(const source of [view,model]){
    assert.doesNotMatch(source,/\bfetch\s*\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB|service_role|supabase|\.rpc\s*\(/i);
  }
  assert.doesNotMatch(html,/<input[^>]*type="file"/i);
  assert.doesNotMatch(html,/<input[^>]*name="(ssn|itin|income|bank|w2)"/i);
  assert.doesNotMatch(view,/\bsms:\b|\.sendMessage\(|twilio|telnyx|mercadoPago/i);
});
