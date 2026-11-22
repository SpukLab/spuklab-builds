import test from 'node:test';
import assert from 'node:assert/strict';
import {createDraft, addField, publishForm} from './form-model.mjs';
import {createFormRequest, submitFormRequest} from './flow-model.mjs';
import {buildUnifiedProfile} from './unified-profile-model.mjs';
import {readFileSync} from 'node:fs';

const tenant='estudio-a', otherTenant='estudio-b', personId='persona-a';
const now='2026-11-22T12:00:00Z';
const booking=(id,startsAt,status,opts={})=>({
  tenantId:tenant, personId, id, serviceId:'corte', startsAt,status,
  service:'Corte',professional:'Profesional ejemplo',...opts
});
const person={id:personId,tenantId:tenant,displayName:'Persona Demo',
  phone:'Contacto ficticio',email:'Sin correo',sharedNote:'Nota compartida',staffNotes:'Nota privada'};
function req({targetTenant=tenant,targetPerson=personId,appointmentId='turno-2'}={}) {
  const editor={tenantId:targetTenant,role:'owner'};
  let form=createDraft({id:'plantilla-a',tenantId:targetTenant,serviceId:'corte',title:'Antes de venir',role:'owner'});
  form=addField(form,{id:'preferencia',label:'Horario preferido',type:'select',required:true,options:['Mañana','Tarde']},editor);
  form=publishForm(form,{...editor,expectedVersion:form.version});
  return createFormRequest({requestId:'solicitud-a',form,tenantId:targetTenant,
    personId:targetPerson,serviceId:'corte',appointmentId,now,
    expiresAt:'2026-11-25T12:00:00Z',actorRole:'owner'});
}
function sample(overrides={}) {
  return {
    tenantId:tenant, person, actorRole:'owner',now,
    appointments:[
      booking('turno-1','2026-11-20T10:00:00Z','attended'),
      booking('turno-2','2026-11-25T10:00:00Z','confirmed'),
      booking('turno-3','2026-11-26T10:00:00Z','cancelled')
    ],
    requests:[req()],...overrides
  };
}
test('muestra próximo turno y ordena historial sin duplicar fechas',()=>{
  const view=buildUnifiedProfile(sample());
  assert.equal(view.nextAppointment.id,'turno-2');
  assert.equal(view.upcoming.length,1);
  assert.deepEqual(view.history.map(x=>x.id),['turno-3','turno-1']);
  assert.equal(view.totalAppointments,3);
  assert.equal(view.forms[0].statusCode,'pending');
});

test('respuestas enviadas se presentan solamente al propietario y administrador',()=>{
  const sent=submitFormRequest(req(),{tenantId:tenant,personId,now:'2026-11-22T13:00:00Z',expectedRevision:1,answers:{preferencia:'Tarde'}});
  assert.equal(sent.ok,true);
  for(const role of ['owner','admin']){
    const view=buildUnifiedProfile(sample({actorRole:role,requests:[sent.request]}));
    assert.equal(view.forms[0].items[0].value,'Tarde');
    assert.equal(view.person.staffNotes,'Nota privada');
  }
  for(const role of ['operator','viewer']){
    const view=buildUnifiedProfile(sample({actorRole:role,requests:[sent.request]}));
    assert.deepEqual(view.forms[0].items,[]);
    assert.equal(view.person.staffNotes,'');
    assert.equal(view.person.sharedNote,'');
    assert.equal(view.canSeeAnswers,false);
  }
});

test('ignora registros de otro establecimiento y otra persona',()=>{
  const foreign=booking('ajeno','2026-11-23T10:00:00Z','confirmed',{tenantId:otherTenant});
  const otherPerson=booking('otro','2026-11-23T10:00:00Z','confirmed',{personId:'otra-persona'});
  const view=buildUnifiedProfile(sample({
    appointments:[...sample().appointments,foreign,otherPerson],
    requests:[req(),req({targetTenant:otherTenant}),req({targetPerson:'otra-persona'})]
  }));
  assert.equal(view.totalAppointments,3);
  assert.equal(view.forms.length,1);
  assert.ok(view.upcoming.every(a=>a.id!=='ajeno'&&a.id!=='otro'));
});

test('rechaza atribuir formulario a turno de otro servicio o persona',()=>{
  const forged=req({appointmentId:'turno-x'});
  const wrongService=booking('turno-x','2026-11-24T10:00:00Z','confirmed',{serviceId:'coloracion'});
  const view=buildUnifiedProfile(sample({appointments:[...sample().appointments,wrongService],requests:[forged]}));
  assert.equal(view.forms.length,0);
  const wrongPerson=booking('turno-x','2026-11-24T10:00:00Z','confirmed',{personId:'otra-persona'});
  const v2=buildUnifiedProfile(sample({appointments:[...sample().appointments,wrongPerson],requests:[forged]}));
  assert.equal(v2.forms.length,0);
});

test('marcar pendiente vencida sin eliminar el historial',()=>{
  const expired=buildUnifiedProfile(sample({now:'2026-12-02T12:00:00Z'}));
  assert.equal(expired.forms[0].statusCode,'expired');
  assert.equal(expired.forms[0].items.length,0);
});

test('no admite contexto inválido ni roles sin autorización',()=>{
  assert.throws(()=>buildUnifiedProfile(sample({tenantId:otherTenant})),/tenant_mismatch/);
  assert.throws(()=>buildUnifiedProfile(sample({actorRole:'patient'})),/forbidden/);
  assert.throws(()=>buildUnifiedProfile(sample({now:'fecha sin formato'})),/invalid_context/);
});

test('la pantalla es una ficha compacta, no otra agenda ni un acceso a APIs',()=>{
  const html=readFileSync(new URL('./flow-preview.html',import.meta.url),'utf8');
  const js=readFileSync(new URL('./flow-preview.mjs',import.meta.url),'utf8');
  const model=readFileSync(new URL('./unified-profile-model.mjs',import.meta.url),'utf8');
  for(const id of ['ficha-datos','ficha-proximos','ficha-historial','ficha-formularios']){
    assert.match(html,new RegExp('id="'+id+'"'));
  }
  assert.match(js,/buildUnifiedProfile\(/);
  assert.match(html,/profile-panel/);
  assert.match(html,/Solo una demostración/);
  assert.doesNotMatch(js,/innerHTML|insertAdjacentHTML|document\.write/);
  for(const source of [js,model]){
    assert.doesNotMatch(source,/\bfetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|\.rpc\s*\(/);
  }
});
