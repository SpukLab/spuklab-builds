import { createDraft, addField, publishForm } from './form-model.mjs';
import { createFormRequest, viewRequestForPerson, submitFormRequest } from './flow-model.mjs';
import { buildUnifiedProfile } from './unified-profile-model.mjs';

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
function profileFixtures() {
  const {tenantId,serviceId}=request ? {tenantId:request.tenantId,serviceId:request.serviceId} : active();
  const label=catalog[tenantId].services.find(s=>s.id===serviceId)?.label || 'Servicio de prueba';
  const appointment=(offsetDays)=>new Date(Date.now()+offsetDays*86400000).toISOString();
  return {
    tenantId,
    person:{
      tenantId,
      id:personId,
      displayName:'Persona de prueba',
      phone:'Sin WhatsApp real',
      email:'Sin correo real',
      sharedNote:'Prefiere recibir avisos de turnos (dato ficticio).',
      staffNotes:'Preparar el espacio antes de la visita (dato ficticio).'
    },
    appointments:[
      {tenantId,personId,id:appointmentId,serviceId,startsAt:appointment(2),status:'confirmed',service:label,professional:'Profesional de prueba'},
      {tenantId,personId,id:'turno-demo-historico',serviceId,startsAt:appointment(-14),status:'attended',service:label,professional:'Profesional de prueba'}
    ],
    requests:request?[request]:[],
    actorRole:'owner',
    now:clock()
  };
}
const localWhen = iso=>new Intl.DateTimeFormat('es-AR',{
  dateStyle:'medium',timeStyle:'short',timeZone:'America/Argentina/Buenos_Aires'
}).format(new Date(iso));

function renderAppointments(id,items) {
  const wrap=$(id);wrap.replaceChildren();
  if(!items.length){
    wrap.append(element('p','No hay turnos en esta sección.','muted'));
    return;
  }
  for(const a of items){
    const card=element('div',null,'profile-appointment');
    card.append(element('strong',a.service+' · '+a.status));
    card.append(element('div',localWhen(a.startsAt)+' · '+a.professional,'profile-meta'));
    wrap.append(card);
  }
}
function addDetail(list,key,value) {
  list.append(element('dt',key),element('dd',value || '—'));
}
function drawStaff() {
  const summary=$('ficha-resumen');
  const forms=$('ficha-formularios');
  const details=$('ficha-datos');
  details.replaceChildren();
  forms.replaceChildren();
  status('estado-ficha','');
  let view;
  try{
    view=buildUnifiedProfile(profileFixtures());
  }catch(error){
    summary.textContent='No se pudo mostrar la ficha de ejemplo.';
    status('estado-ficha',error.code || 'Error de ficha');
    return;
  }
  summary.textContent=view.person.name+' · Ficha de demostración · Sin conexión con personas reales';
  $('ficha-count-upcoming').textContent=String(view.upcoming.length);
  $('ficha-count-history').textContent=String(view.history.length);
  $('ficha-count-forms').textContent=String(view.forms.length);
  addDetail(details,'Nombre',view.person.name);
  addDetail(details,'Contacto',view.person.phone);
  addDetail(details,'Correo',view.person.email);
  addDetail(details,'Información compartida',view.person.sharedNote);
  addDetail(details,'Notas internas',view.person.staffNotes);
  renderAppointments('ficha-proximos',view.upcoming);
  renderAppointments('ficha-historial',view.history);
  if(!view.forms.length){
    forms.append(element('p','Todavía no se prepararon formularios para esta persona.','muted'));
  }else{
    for(const form of view.forms){
      const card=element('div',null,'profile-appointment');
      card.append(element('strong',form.title));
      card.append(element('div','Estado: '+form.status,'profile-meta'));
      if(form.items.length && view.canSeeAnswers){
        const answerWrap=element('div',null,'profile-answer');
        for(const item of form.items){
          const answer=element('div',null,'answer');
          answer.append(element('strong',item.label));
          const value=typeof item.value==='boolean'?(item.value?'Sí':'No'):(item.value||'—');
          answer.append(element('p',String(value)));
          answerWrap.append(answer);
        }
        card.append(answerWrap);
      }
      forms.append(card);
    }
  }
  status('estado-ficha','Vista unificada ficticia. Contactos, turnos y respuestas desaparecen al recargar.');
}
services();
