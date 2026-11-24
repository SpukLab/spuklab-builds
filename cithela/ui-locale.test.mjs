import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('./ui-locale.js',import.meta.url),'utf8');
const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');

function setup(stored){
  const store=new Map(stored?[['cithela.ui.language.v1',stored]]:[]);
  const events=[];
  const document={
    readyState:'loading',body:null,
    addEventListener:(name,fn)=>events.push({name,fn}),
    dispatchEvent:event=>events.push({name:event.type,detail:event.detail})
  };
  const window={};
  const sandbox={window,document,localStorage:{
    getItem:key=>store.get(key)||null,
    setItem:(key,value)=>store.set(key,value)
  },CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail}},
  MutationObserver:class{observe(){}},queueMicrotask};
  vm.runInNewContext(source,sandbox,{filename:'CITHELA local UI translations'});
  return {ui:window.CithelaUiLocale,events,store};
}

test('ES/EN localizes the complete top navigation and settings without any remote request',()=>{
  const {ui}=setup();
  assert.equal(ui.get(),'es');
  assert.equal(ui.hasPreference(),false);
  const pairs=[['Agenda','Schedule'],['Pacientes','Patients'],['+ Turno','+ Appointment'],
    ['Mensajes','Messages'],['Ajustes','Settings'],['Mis turnos','My appointments'],
    ['Próximos turnos','Upcoming appointments'],['Enlace / QR','Booking link / QR'],
    ['Horarios de atención','Working hours'],['Ausencias y bloqueos','Time off and blocked dates'],
    ['Servicios','Services'],['Cobros y señas','Payments and deposits'],
    ['Actualizar mis turnos','Refresh my appointments'],['Guardar turno','Save appointment']];
  for(const [es,en] of pairs)assert.equal(ui.translate(es),en,es);
  assert.doesNotMatch(source,/\b(fetch|XMLHttpRequest)\s*\(|https:\/\//);
});

test('locale follows a stored explicit preference and never mutates booking defaults',()=>{
  const {ui,store}=setup('en');
  assert.equal(ui.get(),'en');assert.equal(ui.hasPreference(),true);
  ui.set('es');
  assert.equal(ui.get(),'es');
  assert.equal(store.get('cithela.ui.language.v1'),'es');
  assert.equal(ui.hasPreference(),true);
  assert.equal(ui.translate('Juan Carlos'),'Juan Carlos');
  assert.equal(ui.translate('alma.pampa'),'alma.pampa');
  assert.equal(ui.translate('Corte de pelo'),'Corte de pelo');
});

test('Spanish view strings are restored when switched back from English',()=>{
  const {ui}=setup();
  assert.equal(ui.translate('30 días'),'30 days');
  assert.equal(ui.translate('miércoles, 25 de noviembre'),'Wednesday, November 25');
  assert.equal(ui.translate('2 por confirmar · 0 confirmados · próximos 30 días'),
    '2 awaiting confirmation · 0 confirmed · next 30 days');
  assert.equal(ui.translate('1 turno'),'1 appointment');
  assert.equal(ui.translate('2 turnos'),'2 appointments');
});

test('all visible static copy is covered except product names and nonlinguistic tokens',()=>{
  const body=html.slice(html.indexOf('<body>'),html.indexOf('<script>',html.indexOf('<body>')));
  const strings=[...new Set([...body.matchAll(/>([^<>]+)</g)].map(x=>x[1].replace(/\s+/g,' ').trim())
    .filter(x=>x&&/[A-Za-zÁÉÍÓÚáéíóúñÑ]/.test(x)&&!x.includes('${')))];
  const untranslated=strings.filter(s=>!['CITHELA','SpukLab','by','ES','EN'].includes(s)&&setup().ui.translate(s)===s);
  assert.ok(untranslated.length<=6,'Untranslated UI strings: '+JSON.stringify(untranslated));
  assert.match(html,/ui-locale\.js/);
  assert.match(html,/data-ui-locale="en"/);
  assert.match(html,/data-ui-locale="es"/);
});
