import test from 'node:test';
import assert from 'node:assert/strict';
import { createDraft, addField, publishForm } from './form-model.mjs';
import { createFormRequest, viewRequestForPerson, submitFormRequest, revokeFormRequest, viewSubmittedForStaff } from './flow-model.mjs';
const A='peluqueria-a',B='tattoo-b',P='persona-ficticia-1';
const T='2026-11-20T20:00:00Z',END='2026-11-22T20:00:00Z';
function fixture() {
  const editor = {tenantId:A,role:'owner'};
  let form=createDraft({id:'template-1',tenantId:A,serviceId:'coloracion',title:'Antes de tu cita',role:'owner'});
  form=addField(form,{id:'horario',label:'Horario preferido',type:'select',required:true,options:['Mañana','Tarde']},editor);
  form=addField(form,{id:'comentario',label:'Comentario opcional',type:'textarea',required:false},editor);
  return publishForm(form,{...editor,expectedVersion:form.version});
}
const args=()=>({requestId:'solicitud-ficticia-01',form:fixture(),tenantId:A,personId:P,serviceId:'coloracion',appointmentId:'turno-ejemplo-01',now:T,expiresAt:END,actorRole:'admin'});
const newRequest=()=>createFormRequest(args());
const answers={horario:'Tarde',comentario:'Sin preferencias adicionales'};
const submit=(request,opts={})=>submitFormRequest(request,{tenantId:A,personId:P,now:'2026-11-21T10:00:00Z',expectedRevision:1,answers,...opts});

test('solicitud toma snapshot inmutable lógicamente del formulario publicado',()=>{
  const f=fixture();
  const request=createFormRequest({...args(),form:f});
  assert.equal(request.status,'pending');
  assert.equal(request.template.version,f.version);
  assert.equal(request.appointmentId,'turno-ejemplo-01');
  f.fields[0].label='cambiado posteriormente';
  assert.equal(request.template.fields[0].label,'Horario preferido');
});
test('prohíbe emitir para otros establecimientos, servicios y roles',()=>{
  assert.throws(()=>createFormRequest({...args(),tenantId:B}),/tenant_mismatch/);
  assert.throws(()=>createFormRequest({...args(),serviceId:'consulta'}),/service_mismatch/);
  assert.throws(()=>createFormRequest({...args(),actorRole:'patient'}),/forbidden/);
  assert.throws(()=>createFormRequest({...args(),form:{...fixture(),status:'draft'}}),/form_not_published/);
});
test('fecha y expiración se validan antes de crear',()=>{
  assert.throws(()=>createFormRequest({...args(),expiresAt:T}),/invalid_expiry/);
  assert.throws(()=>createFormRequest({...args(),expiresAt:'2027-03-20T20:00:00Z'}),/invalid_expiry/);
  assert.throws(()=>createFormRequest({...args(),now:'mañana'}),/invalid_time/);
});
test('vista de persona no expone campos si está vencido',()=>{
  const request=newRequest();
  const view=viewRequestForPerson(request,{tenantId:A,personId:P,now:'2026-11-21T10:00:00Z'});
  assert.equal(view.status,'pending');
  assert.equal(view.fields.length,2);
  assert.equal('answerData' in view,false);
  const expired=viewRequestForPerson(request,{tenantId:A,personId:P,now:END});
  assert.equal(expired.status,'expired');
  assert.equal(expired.fields.length,0);
  assert.throws(()=>viewRequestForPerson(request,{tenantId:A,personId:'otra-persona',now:T}),/person_mismatch/);
});
test('rechaza respuestas inválidas y mantiene solicitud pendiente',()=>{
  const request=newRequest();
  const result=submit(request,{answers:{horario:'Noche'}});
  assert.equal(result.ok,false);
  assert.equal(result.errors.horario,'invalid_option');
  assert.equal(request.status,'pending');
  assert.equal(request.answerData,null);
});
test('respuesta válida vinculada a persona y turno solo visible a personal autorizado',()=>{
  const request=newRequest();
  const result=submit(request);
  assert.equal(result.ok,true);
  assert.equal(result.request.status,'submitted');
  assert.equal(result.request.revision,2);
  const staff=viewSubmittedForStaff(result.request,{tenantId:A,actorRole:'admin'});
  assert.equal(staff.personId,P);
  assert.equal(staff.appointmentId,'turno-ejemplo-01');
  assert.equal(staff.items[0].value,'Tarde');
  assert.throws(()=>viewSubmittedForStaff(result.request,{tenantId:B,actorRole:'owner'}),/tenant_mismatch/);
  assert.throws(()=>viewSubmittedForStaff(result.request,{tenantId:A,actorRole:'patient'}),/forbidden/);
  const userView=viewRequestForPerson(result.request,{tenantId:A,personId:P,now:'2026-11-21T11:00:00Z'});
  assert.equal('answerData' in userView,false);
  assert.equal(userView.status,'submitted');
});
test('reintento igual no crea respuesta duplicada; diferente requiere nueva solicitud',()=>{
  const first=submit(newRequest());
  const repeated=submit(first.request,{expectedRevision:2,answers:{comentario:answers.comentario,horario:answers.horario}});
  assert.equal(repeated.replayed,true);
  assert.equal(repeated.request.revision,2);
  assert.throws(()=>submit(first.request,{answers:{horario:'Mañana',comentario:'otra'}}),/already_submitted/);
});
test('revocación, caducidad y control de versión',()=>{
  const request=newRequest();
  assert.throws(()=>submit(request,{expectedRevision:999}),/stale_write/);
  assert.throws(()=>submit(request,{now:END}),/expired/);
  assert.throws(()=>submit(request,{personId:'otro'}),/person_mismatch/);
  assert.throws(()=>revokeFormRequest(request,{tenantId:A,actorRole:'operator',expectedRevision:1}),/forbidden/);
  assert.throws(()=>revokeFormRequest(request,{tenantId:A,actorRole:'owner',expectedRevision:2}),/stale_write/);
  const revoked=revokeFormRequest(request,{tenantId:A,actorRole:'admin',expectedRevision:1});
  assert.equal(revoked.status,'revoked');
  assert.throws(()=>submit(revoked),/revoked/);
  assert.equal(viewSubmittedForStaff(revoked,{tenantId:A,actorRole:'owner'}),null);
});
