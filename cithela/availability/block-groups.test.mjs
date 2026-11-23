import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {groupBlocks}=require('./block-groups.js');

const base=Date.parse('2026-11-27T03:00:00Z'),DAY=86400000;
const created='2026-11-23T19:45:00Z';
function block(i,{id='block-'+i,days=6,createdAt=created,reason='Vacaciones',resource=null,startMs=base}={}){
  return {
    id,resource_id:resource,starts_at:new Date(startMs).toISOString(),
    ends_at:new Date(startMs+days*DAY).toISOString(),
    reason,created_at:createdAt
  };
}
function sequence(){
  const days=[6,6,6,6,6,6,4];let next=base;
  return days.map((count,i)=>{
    const b=block(i,{days:count,startMs:next,
      createdAt:new Date(Date.parse(created)+i*1300).toISOString()});
    next+=count*DAY;
    return b;
  });
}
test('seven cloud chunks from same operation collapse into one 40-day vacation',()=>{
  const seven=sequence();
  const result=groupBlocks(seven);
  assert.equal(result.length,1);
  assert.equal(result[0].grouped,true);
  assert.equal(result[0].blocks.length,7);
  assert.equal((Date.parse(result[0].ends_at)-Date.parse(result[0].starts_at))/DAY,40);
  assert.equal(result[0].id,'block-0');
});
test('different reasons, resource or create session must not merge',()=>{
  const first=block(1);
  const second=block(2,{startMs:base+6*DAY,reason:'Feriado'});
  assert.equal(groupBlocks([first,second]).length,2);
  assert.equal(groupBlocks([first,block(2,{startMs:base+6*DAY,resource:'chair'})]).length,2);
  assert.equal(groupBlocks([first,block(2,{startMs:base+6*DAY,createdAt:'2026-11-24T19:45:00Z'})]).length,2);
  assert.equal(groupBlocks([first,block(2,{startMs:base+7*DAY})]).length,2);
  assert.equal(groupBlocks([first,block(2,{startMs:base+6*DAY,reason:''})]).length,2);
});
test('single-day and arbitrary old blocks stay individually accessible',()=>{
  const a=block(1,{days:1});
  const b=block(2,{days:1,startMs:base+DAY});
  assert.equal(groupBlocks([a,b]).length,2);
  assert.equal(groupBlocks([a,b]).every(g=>g.grouped===false),true);
  assert.equal(groupBlocks([block(1,{createdAt:null})])[0].grouped,false);
  assert.equal(groupBlocks([block(1,{days:8})])[0].grouped,false);
});
test('never mutates cloud cache or combines into a group beyond 90 days',()=>{
  const original=sequence();
  const copy=JSON.stringify(original);
  assert.equal(groupBlocks(original).length,1);
  assert.equal(JSON.stringify(original),copy);
  const over=Array.from({length:17},(_,i)=>block(i,{startMs:base+i*6*DAY}));
  assert.ok(groupBlocks(over).length>=2);
});
test('grouping helper never writes to DB, auth, network or client storage',()=>{
  const text=readFileSync(new URL('./block-groups.js',import.meta.url),'utf8');
  assert.doesNotMatch(text,/fetch\(|XMLHttpRequest|\.rpc\(|update\(|delete\(|localStorage|sessionStorage|supabase/i);
});
test('professional UX has exactly one shared toolbar above tab bar and distinct reservations settings',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.equal((html.match(/id="professional-public-booking-shortcut"/g)||[]).length,1);
  assert.ok(html.indexOf('id="professional-public-booking-shortcut"')<
    html.indexOf('id="professional-tabs"'));
  assert.match(html,/id="professional-share-copy"/);
  assert.match(html,/id="professional-share-native"/);
  assert.match(html,/href="\.\/compartir\.html" aria-label="Ver código QR de la agenda"/);
  assert.match(html,/function updateProfessionalBookingShareVisibility\(\)/);
  assert.match(html,/professionalCloudReady\(\)&&\['owner','admin','operator'\]/);
  assert.match(html,/professionalBookingShareState\.tenantId===s\.tenant\?\.id/);
  assert.match(html,/function copyProfessionalBookingLink\(\)/);
  assert.match(html,/function shareProfessionalBookingLink\(\)/);
  assert.match(html,/const data=await CithelaCloud\.professionalBookingShare\(\)/);
  assert.match(html,/Idioma de las reservas y coberturas/);
  assert.doesNotMatch(html,/Vincular mi WhatsApp para ingresar/);
  assert.match(html,/href="\.\/acceso-whatsapp\.html">Ingresar con WhatsApp/);
  assert.match(html,/id="patient-enroll-panel"/);
  assert.match(html,/id="professional-booking-language"/);
});
test('Cloud fetch reads created_at to group reliably and private deletion stays authenticated',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.match(html,/select\('id,resource_id,starts_at,ends_at,reason,created_at'\)/);
  assert.match(html,/CithelaBlockGroups\?\.groupBlocks/);
  assert.match(html,/function removeAvailabilityBlockGroup\(/);
  assert.match(html,/await CithelaCloud\.blockCommand\(/);
  assert.match(html,/availabilityBlockGroupBusy/);
  assert.match(html,/Los turnos existentes no cambiarán/);
  assert.match(html,/requestId:cloudRequestId\('vacation-delete-/);
  assert.match(html,/created_at/);
  assert.match(html,/block-groups\.js/);
  const i=html.indexOf('<script>\n// CITHELA PRODUCT SHELL');
  assert.ok(i>0);
  const script=html.slice(i+8,html.indexOf('</script>',i));
  assert.doesNotThrow(()=>new vm.Script(script));
});
