import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
function section(begin,end){
  const a=html.indexOf(begin),b=html.indexOf(end,a+begin.length);
  assert.ok(a>=0&&b>a,'Missing code section '+begin);
  return html.slice(a,b);
}
function phoneParser(){
  return new Function(section('function ntPhoneForBooking(input){','function ntRenderPersonOptions(')+
    '\nreturn ntPhoneForBooking;')();
}
function fixture({name='Paciente Nuevo',number='221 1234567',people=[]}={}){
  const elements={
    'new-person-name':{value:name,focus(){}},
    'new-person-phone':{value:number},
    'person-create-save':{disabled:false},
    'person-create-details':{open:true},
    'person-created-next':{hidden:true,innerHTML:''}
  };
  const calls=[],messages=[],tenantId='tenant-A',savedPeople=[...people], events=[];
  const cloud={
    state:()=>({tenant:{id:tenantId},people:savedPeople}),
    resolvePerson:async command=>{
      calls.push(command);
      savedPeople.push({id:'123e4567-e89b-42d3-a456-426614174000',
        display_name:command.name,phone_e164:command.phone});
      return {ok:true,code:'person_created'};
    },
    refresh:async()=>{}
  };
  const create=new Function('$','professionalCloudReady','professionalCloudWritable','CithelaCloud','DB',
    'ntPhoneForBooking','normalizePhone','toast','renderPacs','cloudRequestId','escHtml','recordEvent',
    section('let personCreateBusy=false;','// ── FICHA CON ARCHIVOS Y OBSERVACIONES ──')+
    '\nreturn {crearPersona,personCreatedNext,personCreateAnother};')(
      id=>elements[id]||null,()=>true,()=>true,cloud,
      {p:()=>[],sp:()=>{}},phoneParser(),
      value=>String(value||'').replace(/\D/g,''),
      msg=>messages.push(msg),()=>{},()=> 'person-unique',
      value=>String(value).replace(/&/g,'&amp;'),event=>events.push(event));
  return {create,elements,calls,messages,savedPeople,events};
}
test('both patient entry paths accept 10-digit Argentine numbers',()=>{
  const form=section('id="p-medico-pacientes"','id="p-medico-nuevo"');
  assert.match(form,/id="new-person-phone"[^>]*placeholder="221 1234567"/);
  assert.match(form,/id="person-created-next"/);
  assert.match(form,/id="person-create-save"/);
  assert.equal(phoneParser()('221 1234567'),'+5492211234567');
  assert.equal(phoneParser()('+54 9 221 1234567'),'+5492211234567');
});
test('new patient is stored by the existing tenant directory and offers both next actions',async()=>{
  const f=fixture();await f.create.crearPersona();
  assert.equal(f.calls.length,1);
  assert.deepEqual(f.calls[0],{tenantId:'tenant-A',requestId:'person-unique',
    phone:'+5492211234567',name:'Paciente Nuevo',createIfMissing:true});
  assert.equal(f.elements['new-person-name'].value,'');
  assert.equal(f.elements['new-person-phone'].value,'');
  assert.equal(f.elements['person-create-details'].open,false);
  assert.equal(f.elements['person-created-next'].hidden,false);
  assert.match(f.elements['person-created-next'].innerHTML,/Dar turno/);
  assert.match(f.elements['person-created-next'].innerHTML,/Agregar otra persona/);
  assert.equal(f.elements['person-create-save'].disabled,false);
});
test('existing WhatsApp with a different name never creates another person',async()=>{
  const f=fixture({name:'Nombre Diferente',
    people:[{id:'123e4567-e89b-42d3-a456-426614174001',
      display_name:'Nombre Actual',phone_e164:'+5492211234567'}]});
  await f.create.crearPersona();
  assert.equal(f.calls.length,0);
  assert.equal(f.elements['person-create-details'].open,true);
  assert.match(f.messages.join(' '),/ya pertenece a Nombre Actual/);
});
test('first-run help makes invitations optional and leaves enrollment available',()=>{
  assert.match(html,/No hace falta enviar invitaciones para registrar personas y otorgar turnos/);
  assert.match(html,/id="cithela-first-steps"/);
  assert.match(html,/Primer[a]? persona/);
  assert.match(html,/function openCithelaFirstSteps\(section\)/);
});
