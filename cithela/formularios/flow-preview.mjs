import { createDraft, addField, publishForm } from './form-model.mjs';
import { createFormRequest, viewRequestForPerson, submitFormRequest, viewSubmittedForStaff } from './flow-model.mjs';

// Datos enteramente inventados, solo en memoria de esta pestaña.
// No hay conexiones de red, sesiones, datos persistentes ni pagos.
const catalog = {
  peluqueria: {
    label: 'Peluquería Pampa (demo)',
    services: [
      { id: 'coloracion', label: 'Coloración' },
      { id: 'corte', label: 'Corte de cabello' }
    ]
  },
  tatuaje: {
    label: 'Estudio de tatuajes (demo)',
    services: [
      { id: 'consulta', label: 'Consulta inicial' },
      { id: 'diseno', label: 'Revisión de diseño' }
    ]
  }
};
const $ = id => document.getElementById(id);
const element = (tag, text = null, className = '') => {
  const el = document.createElement(tag);
  if (text !== null) el.textContent = text;
  if (className) el.className = className;
  return el;
};
const personId = 'persona-demo-01';
const appointmentId = 'turno-demo-01';
let serial = 0, request = null;
const active = () => ({ tenantId: $('sector').value, serviceId: $('servicio').value });
const clock = () => new Date().toISOString();
function status(id, value) { $(id).textContent = value; }
function toStep(step) {
  for (const name of ['profesional','cliente','ficha']) {
    const selected = name === step;
    $('tab-'+name).setAttribute('aria-selected', String(selected));
    $('panel-'+name).hidden = !selected;
  }
  if (step === 'cliente') drawClient();
  if (step === 'ficha') drawStaff();
}
function seedForm(tenantId, serviceId) {
  const editor = { tenantId, role: 'owner' };
  serial += 1;
  let form = createDraft({
    id: 'formulario-demo-'+serial,
    tenantId, serviceId,
    role: 'owner',
    title: 'Antes de tu turno · '+catalog[tenantId].services.find(s => s.id === serviceId).label
  });
  form = addField(form, {
    id: 'contacto',
    label: '¿Cómo preferís recibir avisos de tu turno?',
    type: 'select', required: true, options: ['WhatsApp','Correo electrónico']
  }, editor);
  form = addField(form, {
    id: 'comentario',
    label: '¿Querés agregar algún comentario administrativo? (opcional)',
    type: 'textarea', required: false
  }, editor);
  form = addField(form, {
    id: 'confirmacion',
    label: 'Confirmo que los datos son solamente de demostración',
    type: 'checkbox', required: true
  }, editor);
  return publishForm(form, { ...editor, expectedVersion: form.version });
}
function services() {
  const current = $('servicio');
  current.replaceChildren();
  for (const item of catalog[$('sector').value].services) {
    const option = element('option', item.label);
    option.value = item.id;
    current.append(option);
  }
  request = null;
  status('estado-profesional','Seleccioná el servicio y prepará una nueva solicitud ficticia.');
}
$('sector').addEventListener('change', services);
$('servicio').addEventListener('change', () => {
  request = null;
  status('estado-profesional', 'Servicio actualizado. Prepará una solicitud nueva.');
});
for (const tab of document.querySelectorAll('[data-step]')) {
  tab.addEventListener('click', () => toStep(tab.dataset.step));
}
$('crear-solicitud').addEventListener('click', () => {
  try {
    const {tenantId,serviceId} = active();
    const now = clock();
    const expiresAt = new Date(Date.parse(now) + 48 * 3600000).toISOString();
    const form = seedForm(tenantId,serviceId);
    request = createFormRequest({
      requestId: 'solicitud-demo-'+serial,
      form, tenantId, serviceId, personId, appointmentId,
      now, expiresAt, actorRole:'owner'
    });
    status('estado-profesional', 'Solicitud ficticia preparada. Vigencia de prueba: 48 horas. No se envió ningún mensaje.');
    toStep('cliente');
  } catch(e) {
    status('estado-profesional', e.code || 'Error al preparar la demostración.');
  }
});
function drawClient() {
  const form = $('form-cliente');
  const wrap = $('preguntas');
  wrap.replaceChildren();
  form.hidden = true;
  status('estado-cliente','');
  if (!request) {
    $('cliente-info').textContent = 'Primero prepará una solicitud desde la pestaña profesional.';
    return;
  }
  let view;
  try {
    view = viewRequestForPerson(request, {tenantId:request.tenantId,personId,now:clock()});
  } catch(e) {
    status('estado-cliente',e.code);
    return;
  }
  $('cliente-info').textContent =
    'Persona de prueba · '+ request.template.title+' · Estado: '+view.status;
  if (view.status !== 'pending') return;
  form.hidden = false;
  for (const field of view.fields) {
    const block = element('div',null,'question');
    const label = element('label',field.label+(field.required?' *':''));
    let input;
    if (field.type==='select') {
      input = element('select');
      const blank=element('option','Elegí una opción'); blank.value=''; input.append(blank);
      for (const opt of field.options) {
        const option=element('option',opt);option.value=opt;input.append(option);
      }
    } else if (field.type==='textarea') input=element('textarea');
    else {
      input=element('input');
      input.type=field.type==='checkbox'?'checkbox':'text';
    }
    input.id='respuesta-'+field.id;input.name=field.id;
    if (field.type==='checkbox') {label.className='check';label.prepend(input);block.append(label);}
    else {label.htmlFor=input.id;block.append(label,input);}
    wrap.append(block);
  }
}
$('form-cliente').addEventListener('submit',event => {
  event.preventDefault();
  if (!request) return;
  const answers={};
  for (const field of request.template.fields) {
    const input=$('respuesta-'+field.id);
    answers[field.id]=field.type==='checkbox'?input.checked:input.value;
  }
  try {
    const result=submitFormRequest(request,{
      tenantId:request.tenantId, personId,now:clock(),
      expectedRevision:request.revision,answers
    });
    if (!result.ok) {
      status('estado-cliente',
        Object.entries(result.errors).map(([id,error]) => id+': '+error).join(' · '));
      return;
    }
    request=result.request;
    status('estado-cliente', 'Datos validados únicamente en memoria. Ningún dato se envió.');
    toStep('ficha');
  } catch(e) {
    status('estado-cliente',e.code || 'No se pudo validar el formulario.');
  }
});
function drawStaff() {
  const summary=$('ficha-resumen');
  const responses=$('ficha-respuestas');
  responses.replaceChildren();
  status('estado-ficha','');
  if (!request) {summary.textContent='Todavía no se preparó una solicitud.';return;}
  summary.textContent='Persona de prueba · '+request.template.title+
    ' · Estado: '+request.status+
    ' · Servicio: '+catalog[request.tenantId].services.find(s=>s.id===request.serviceId)?.label;
  const data=viewSubmittedForStaff(request,{tenantId:request.tenantId,actorRole:'owner'});
  if (!data) {status('estado-ficha','Todavía no hay respuestas.');return;}
  for (const item of data.items) {
    const box=element('div',null,'answer');
    box.append(element('strong',item.label));
    box.append(element('p', typeof item.value==='boolean'?(item.value?'Sí':'No'):(item.value||'—')));
    responses.append(box);
  }
  status('estado-ficha','Respuestas visibles solo en la simulación. Se borran al cerrar o recargar esta pestaña.');
}
services();
