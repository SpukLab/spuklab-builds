import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { instantiatePreset, listPresetChoices } from './presets.mjs';
import { addField, publishForm, validateAnswers } from './form-model.mjs';

const tenant = 'salon-prueba';
const params = { tenantId: tenant, serviceId: 'coloracion', id: 'plantilla-ficticia', role: 'owner' };
const list = activity => listPresetChoices(activity);

test('cada actividad ve ejemplos pertinentes y plantillas transversales', () => {
  const hair = list('peluqueria');
  assert.deepEqual(hair.map(x => x.id), ['basico', 'peluqueria', 'asesoria']);
  const tattoo = list('tattoo');
  assert.deepEqual(tattoo.map(x => x.id), ['basico', 'tatuajes', 'asesoria']);
  const clinic = list('consultorio');
  assert.deepEqual(clinic.map(x => x.id), ['basico', 'asesoria']);
  assert.ok(!clinic.some(x => /clinica|receta/i.test(x.name)));
  assert.throws(() => list(''), /invalid_activity/);
});

test('cargar un preset crea borrador editable vinculado al tenant y servicio', () => {
  let form = instantiatePreset({presetId:'peluqueria',...params});
  assert.equal(form.status,'draft');
  assert.equal(form.tenantId,tenant);
  assert.equal(form.serviceId,'coloracion');
  assert.equal(form.fields.length,3);
  assert.ok(form.fields.every(f => !['file', 'date'].includes(f.type)));
  form=addField(form,{id:'extra',label:'Otra pregunta administrativa',type:'text'},{tenantId:tenant,role:'owner'});
  assert.equal(form.fields.length,4);
  form=publishForm(form,{tenantId:tenant,role:'owner',expectedVersion:form.version});
  assert.equal(form.status,'published');
  const answers={servicio:'Sí',referencias:'No',contacto:'Correo electrónico',extra:'A coordinar'};
  assert.equal(validateAnswers(form,answers).ok,true);
});

test('prohibición de edición para operador e identidad separada por cliente', () => {
  assert.throws(()=>instantiatePreset({presetId:'basico',...params,role:'operator'}),/forbidden/);
  const a=instantiatePreset({presetId:'basico',...params});
  const b=instantiatePreset({presetId:'basico',...params,tenantId:'otro-establecimiento',id:'otra-plantilla'});
  assert.equal(a.tenantId,tenant);
  assert.equal(b.tenantId,'otro-establecimiento');
  a.fields[0].options[0]='Cambiado localmente';
  assert.equal(b.fields[0].options[0],'WhatsApp');
  assert.equal(instantiatePreset({presetId:'basico',...params}).fields[0].options[0],'WhatsApp');
  assert.throws(()=>addField(a,{id:'otro',label:'Pregunta'},{tenantId:'otro-establecimiento',role:'owner'}),/tenant_mismatch/);
});

test('tipos y límites consistentes con form-model; sin campos clínicos', () => {
  for (const preset of ['basico','peluqueria','tatuajes','asesoria']) {
    const form=instantiatePreset({presetId:preset,...params});
    assert.ok(form.fields.length>0 && form.fields.length<=15);
    for (const field of form.fields) {
      assert.ok(['text','textarea','select','checkbox'].includes(field.type));
      assert.match(field.id,/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
      assert.ok(field.label.length>0 && field.label.length<=120);
      if(field.type==='select') assert.ok(field.options.length>=2 && field.options.length<=12);
    }
  }
  assert.throws(()=>instantiatePreset({presetId:'desconocido',...params}),/preset_not_found/);
});

test('la interfaz conserva la creación manual y exhibe advertencia de privacidad', () => {
  const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
  const js=readFileSync(new URL('./prototype.mjs',import.meta.url),'utf8');
  const presets=readFileSync(new URL('./presets.mjs',import.meta.url),'utf8');
  assert.match(html,/id="preset"/);
  assert.match(html,/id="use-preset"/);
  assert.match(html,/id="create"/);
  assert.match(html,/No ingreses datos personales ni clínicos reales/);
  assert.match(js,/listPresetChoices/);
  assert.match(js,/instantiatePreset/);
  assert.match(js,/createDraft/);
  for(const source of [js,presets]){
    assert.doesNotMatch(source,/\bfetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|\.rpc\s*\(/);
  }
  assert.doesNotMatch(js,/innerHTML|insertAdjacentHTML|document\.write/);
});
