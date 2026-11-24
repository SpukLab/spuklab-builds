import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
const start=html.indexOf('function cloudGroupPersonAppointments(');
const end=html.indexOf('async function cloudVerFicha(id)',start);
assert.ok(start>=0&&end>start,'La función de agrupación debe existir');
const group=new Function(html.slice(start,end)+'\nreturn cloudGroupPersonAppointments;')();
const now=Date.parse('2026-11-22T18:00:00Z');
const appointment=(id,starts_at,status)=>({id,starts_at,status,service_name:'Ejemplo'});

test('próximos pendientes/confirmados en orden cronológico y pasado en historial',()=>{
  const rows=[
    appointment('futuro-2','2026-11-25T13:00:00Z','confirmed'),
    appointment('pasado','2026-11-21T13:00:00Z','attended'),
    appointment('futuro-1','2026-11-23T13:00:00Z','pending'),
    appointment('cancelado','2026-11-24T13:00:00Z','cancelled'),
    appointment('pasado-confirmado','2026-11-20T13:00:00Z','confirmed')
  ];
  const result=group(rows,now);
  assert.deepEqual(result.upcoming.map(x=>x.id),['futuro-1','futuro-2']);
  assert.deepEqual(result.history.map(x=>x.id),['cancelado','pasado','pasado-confirmado']);
  assert.equal(result.shown,5);
  assert.equal(result.limitReached,false);
  assert.equal(rows[0].id,'futuro-2','No mutar la lista original');
});
test('sin turnos y cortes de consulta de 50',()=>{
  assert.deepEqual(group([],now),{upcoming:[],history:[],shown:0,limitReached:false});
  assert.deepEqual(group(null,now),{upcoming:[],history:[],shown:0,limitReached:false});
  const rows=Array.from({length:50},(_,i)=>appointment('i-'+i,'2026-10-01T13:00:00Z','attended'));
  assert.equal(group(rows,now).limitReached,true);
});
test('horarios inválidos nunca aparecen como próximos',()=>{
  const rows=[appointment('error','fecha invalida','confirmed'),appointment('vigente','2026-11-22T18:00:00Z','confirmed')];
  assert.deepEqual(group(rows,now).upcoming.map(x=>x.id),['vigente']);
});
test('la ficha mantiene acciones y datos con nuevas secciones plegables',()=>{
  const body=html.slice(html.indexOf('async function cloudVerFicha(id)'),html.indexOf('\nlet personCreateBusy=false;',html.indexOf('async function cloudVerFicha(id)')));
  for(const text of ['CithelaCloud.personHistory(id)','cloudSavePersonProfile','cloudIssuePhoneInvite','cloudIssueInvite','openPatientWhatsApp','ntStartForPerson','Información y notas','Próximos turnos','Historial de turnos','Acceso de la persona · piloto']){
    assert.ok(body.includes(text),text+' debe conservarse');
  }
  assert.match(body,/const grouped=cloudGroupPersonAppointments\(appointments\)/);
  assert.match(body,/const upcomingRows=renderRows\(grouped\.upcoming\)/);
  assert.match(body,/const historyRows=renderRows\(grouped\.history\)/);
  assert.doesNotMatch(body,/cithela_form_|form_submissions|answerData|flow-preview/);
});
test('respeta el aislamiento de cuenta y la consulta existente',()=>{
  const start=html.indexOf('async function personHistory(personId)');
  const end=html.indexOf('async function exportSnapshot()',start);
  const body=html.slice(start,end);
  assert.match(body,/state\.tenant\.id/);
  assert.match(body,/person\)throw Error\('Esta persona no pertenece al espacio activo'/);
  assert.match(body,/\.eq\('tenant_id',tenantId\)\.eq\('person_id',personId\)/);
  assert.match(body,/\.limit\(50\)/);
  assert.match(body,/if\(!state\.session\|\|state\.tenant\?\.id!==tenantId\)/);
});

test('profile keeps all data sources and personal content unmodified by translation',()=>{
 const section=html.slice(html.indexOf('async function cloudVerFicha(id)'),html.indexOf('\nlet personCreateBusy=false;',html.indexOf('async function cloudVerFicha(id)')));
 for(const text of ['data-no-translate','cloud-person-name','cloud-person-phone','cloud-person-alerts','cloud-person-notes','cloud-invite-email'])assert.ok(section.includes(text),text);
 assert.match(section,/p\.patient_shared_note\?'<span data-no-translate>'/);
 assert.match(section,/data-no-translate>\$\{name\}/);
 assert.match(section,/data-no-translate>\$\{escHtml\(t\.reason\)\}/);
});
