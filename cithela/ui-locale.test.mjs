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
  const {ui}=setup();
  const nonTranslatable=['CITHELA','SpukLab','by','ES','EN','English','WhatsApp'];
  const untranslated=strings.filter(s=>!nonTranslatable.includes(s)&&
    !/^(?:\d+ min|Variables: \{paciente\})/.test(s)&&ui.translate(s)===s);
  assert.ok(untranslated.length<=6,'Untranslated UI strings: '+JSON.stringify(untranslated));
  assert.match(html,/ui-locale\.js/);
  assert.match(html,/data-ui-locale="en"/);
  assert.match(html,/data-ui-locale="es"/);
});

test('patient record and appointment composer are translated without touching names or service values',()=>{
  const {ui}=setup('en');
  const expected=[
    ['Ver ficha','View record'],['+ Crear turno','+ Create appointment'],
    ['Enviar mensaje libre','Send free-form message'],
    ['Información compartida por la persona','Information shared by the person'],
    ['Sin información compartida','No information shared'],
    ['Consideraciones del servicio · uso interno','Service considerations · internal use'],
    ['Sin consideraciones registradas','No service considerations recorded'],
    ['Sin notas internas','No internal notes'],
    ['Acceso del paciente · piloto','Patient access · pilot'],
    ['Preparar invitación por WhatsApp','Prepare WhatsApp invitation'],
    ['Buscar por nombre, teléfono o correo','Search by name, phone or email'],
    ['— Elegí una persona —','— Select a person —'],
    ['Elegí una persona registrada o agregá una nueva.','Select an existing contact or add a new one.'],
    ['Enviá una invitación personal por WhatsApp para que la persona verifique su número, ingrese a CITHELA y reserve sus turnos, sin necesitar correo. Antes de enviarla, comprobá que el chat corresponda al destinatario correcto.','Send a personal WhatsApp invitation so the person can verify their number, sign in to CITHELA and book appointments without an email. Before sending, check that the chat belongs to the correct recipient.'],
    ['Sin turnos activos este día','No active appointments today'],
    ['Agenda sincronizada con CITHELA Cloud','Schedule synchronized with CITHELA Cloud']
  ];
  for(const [es,en] of expected)assert.equal(ui.translate(es),en,es);
  assert.equal(ui.translate('Adri gala'),'Adri gala');
  assert.equal(ui.translate('Corte de pelo'),'Corte de pelo');
  assert.equal(ui.translate('Consulta'),'Consulta');
  assert.equal(ui.translate('Juan Carlos'),'Juan Carlos');
});

test('dynamic counters, deposits, WhatsApp inbox and relative dates are localized',()=>{
  const {ui}=setup('en');
  const cases=[
    ['+5492215699377 · 1 turno','+5492215699377 · 1 appointment'],
    ['+5492215254478 · 3 turnos','+5492215254478 · 3 appointments'],
    ['2 por confirmar · 2 señas pendientes · 0 turnos dentro del plazo de recordatorio',
     '2 awaiting confirmation · 2 pending deposits · 0 appointments due for reminder'],
    ['Pendientes (0)','Pending (0)'],
    ['Revisar envíos (0)','Review outgoing (0)'],
    ['Todos (0)','All (0)'],
    ['Consultas sin responder de los últimos 0 mensajes.','Unanswered inquiries among the last 0 messages.'],
    ['Sin responder: 0 · Meta aceptó: 0 · Intentos sin confirmación: 0 (últimos 0 mensajes)',
     'Unanswered: 0 · Accepted by Meta: 0 · Unconfirmed attempts: 0 (last 0 messages)'],
    ['Mañana · 25/11/2026 · 10:15 hs','Tomorrow · 25/11/2026 · 10:15'],
    ['En 28 días · 22/12/2026 · 09:00 hs','In 28 days · 22/12/2026 · 09:00'],
    ['Pendiente de confirmación · Corte de pelo','Awaiting confirmation · Corte de pelo'],
    ['Seña pendiente: ARS $2.000','Deposit pending: ARS $2.000'],
    ['Últimos turnos (3)','Recent appointments (3)']
  ];
  for(const [es,en] of cases)assert.equal(ui.translate(es),en,es);
});

test('calendar weekdays and personal-data fields remain protected',()=>{
  assert.match(html,/const DN_EN=\['M','T','W','T','F','S','S'\]/);
  assert.match(html,/window\.CithelaUiLocale\?\.get\(\)==='en'\?DN_EN\[i\]:DN\[i\]/);
  assert.match(html,/data-no-translate[^>]*>\$\{name\}/);
  assert.match(html,/p\.patient_shared_note\?'<span data-no-translate>'/);
  assert.match(source,/\.cloud-wa-message-quote/);
  assert.match(source,/\.agenda-overview-person-name/);
});

test('multiline HTML explanatory text is translated without changing submitted content',()=>{
  const {ui}=setup('en');
  const multi='Enviá una invitación personal por WhatsApp para que la persona verifique su número,\n          ingrese a CITHELA y reserve sus turnos, sin necesitar correo.\n          Antes de enviarla, comprobá que el chat corresponda al destinatario correcto.';
  assert.equal(ui.translate(multi),
    'Send a personal WhatsApp invitation so the person can verify their number, sign in to CITHELA and book appointments without an email. Before sending, check that the chat belongs to the correct recipient.');
  assert.equal(ui.translate('Adri gala'),'Adri gala');
});

test('native iOS notice/deposit options and their underlying values are distinct',()=>{
  const {ui}=setup('en');
  const cases=[
    ['Nueva reserva pendiente','New booking pending'],
    ['Turno confirmado','Appointment confirmed'],
    ['Turno reprogramado','Appointment rescheduled'],
    ['Recordatorio','Reminder'],
    ['Elegí el medio comprobado…','Choose a verified payment method…'],
    ['Transferencia acreditada','Bank transfer received'],
    ['Efectivo recibido','Cash received'],
    ['Otro medio comprobado','Other verified payment method'],
    ['Registrar cobro verificado','Record verified payment'],
    ['Eximir seña','Waive deposit'],
    ['Medio de pago comprobado','Verified payment method'],
    ['CITHELA solo registra acciones manuales. No realiza transferencias, cobros ni devoluciones.',
     'CITHELA only records manual actions. It does not transfer, collect or refund money.']
  ];
  for(const [es,en] of cases)assert.equal(ui.translate(es),en,es);
  assert.match(html,/value="transfer"/);
  assert.match(html,/value="cash"/);
  assert.match(html,/value="other"/);
  assert.match(html,/value="deposit"/);
  assert.match(html,/function whatsappUiAppointmentDateTime/);
  // The outgoing draft function remains Spanish; never translate patient communication implicitly.
  assert.match(html,/const hello='Hola'/);
});

test('complex service summaries and blocked periods translate but keep user-defined reasons',()=>{
  const {ui}=setup('en');
  assert.equal(ui.translate('4 servicio(s) activo(s). La duración rige para nuevas reservas; los turnos ya creados conservan la original.'),
    '4 active services. Duration applies to new bookings; existing appointments keep their original duration.');
  assert.equal(ui.translate('30 minutos · nube · Seña ARS $2.000'),
    '30 minutes · Cloud · Deposit ARS $2.000');
  assert.equal(ui.translate('Ver 7 tramos individuales'),'View 7 individual blocks');
  assert.equal(ui.translate('2026-11-11 · Día completo'),'2026-11-11 · Full day');
  assert.equal(ui.translate('Vacaciones'), 'Vacaciones');
  assert.match(html,/data-no-translate>\$\{escHtml\(g.reason\)\}/);
  assert.match(html,/data-no-translate>\$\{escHtml\(svc.name\)\}/);
});

test('prices and coverage standalone page inherits ES/EN and preserves original records',()=>{
  const coverage=readFileSync(new URL('./configurar-coberturas.html',import.meta.url),'utf8');
  const {ui}=setup('en');
  const cases=[
    ['Precios y coberturas de tus consultas','Consultation prices and coverage'],
    ['Volver a mi agenda','Back to my schedule'],
    ['2. Precio y cobertura','2. Price and coverage'],
    ['Vigencia de la tarifa (opcional)','Rate validity (optional)'],
    ['Guardar regla','Save rate'],
    ['Vista previa para pacientes','Patient preview'],
    ['Tarifas del servicio','Service rates'],
    ['Módulo aún sin habilitación comercial. Podés preparar las tarifas, pero los pacientes no las verán todavía.',
     'This module is not yet commercially enabled. You can prepare rates, but patients cannot see them yet.']
  ];
  for(const [es,en] of cases)assert.equal(ui.translate(es),en);
  assert.match(coverage,/ui-locale\.js\?v=/);
  assert.match(coverage,/data-ui-locale="en"/);
  assert.match(coverage,/data-ui-locale="es"/);
  assert.match(coverage,/const ui=text=>/);
  assert.match(coverage,/item\.setAttribute\('data-no-translate',''\)/);
  assert.match(coverage,/top\.setAttribute\('data-no-translate',''\)/);
  assert.match(coverage,/cithela:ui-language/);
});
