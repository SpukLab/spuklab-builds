import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
function section(from,to){
  const start=html.indexOf(from);
  const end=html.indexOf(to,start+from.length);
  assert.ok(start>=0&&end>start, 'Missing section: '+from);
  return html.slice(start,end);
}

test('new appointment can add a person without leaving the appointment',()=>{
  const form=section('id="p-medico-nuevo"','id="p-medico-mensajes"');
  for(const id of ['nt-person-filter','nt-pac','nt-person-create-details','nt-person-name',
    'nt-person-phone','nt-person-create-submit','nt-person-create-status']){
    assert.match(form,new RegExp('id="'+id+'"'));
  }
  assert.match(form,/onclick="ntCreatePersonAndSelect\(\)"/);
  assert.match(form,/onclick="crearTurnoMed\(\)">Guardar turno/);
});

test('new person uses existing server-authoritative directory, not direct DB inserts',()=>{
  const create=section('async function ntCreatePersonAndSelect(){','function renderNtCreatedSummary(){');
  assert.match(create,/CithelaCloud\.resolvePerson\(/);
  assert.match(create,/createIfMissing:true/);
  assert.match(create,/cloudRequestId\('person'\)/);
  assert.match(create,/await CithelaCloud\.refresh\(\)/);
  assert.match(create,/Cambió la sesión/);
  assert.match(create,/ya pertenece a/);
  assert.doesNotMatch(create,/\.from\('cithela_people'\)\.insert/);
  assert.match(create,/ntPersonCreateBusy/);
});

test('Argentina phone helper accepts national digits and full international format',()=>{
  const code=section('function ntPhoneForBooking(input){','function ntRenderPersonOptions(');
  const parse=new Function(code+'\nreturn ntPhoneForBooking;')();
  assert.equal(parse('221 123 4567'),'+5492211234567');
  assert.equal(parse('+54 9 221 1234567'),'+5492211234567');
  assert.equal(parse('5492211234567'),'+5492211234567');
  assert.equal(parse('+59891234567'),'+59891234567');
  assert.equal(parse('12345'),'');
});

test('search filters by name without incorrectly matching every phone',()=>{
  const code=section('function ntRenderPersonOptions(preferredId){','function ntStartForPerson(');
  const select={value:'',innerHTML:''},search={value:'Mary'};
  const rows=[{id:'1',display_name:'Adri',phone_e164:'+5492211111111'},
    {id:'2',display_name:'Mary',phone_e164:'+5492212222222'}];
  const render=new Function('$','professionalCloudReady','CithelaCloud','DB','normalizePhone','escHtml',
    code+'\nreturn ntRenderPersonOptions;')(
      id=>id==='nt-pac'?select:search,()=>true,{state:()=>({people:rows})},
      {p:()=>[]},v=>String(v||'').replace(/\D/g,''),v=>String(v).replace(/&/g,'&amp;'));
  render();
  assert.match(select.innerHTML,/Mary/);
  assert.doesNotMatch(select.innerHTML,/Adri/);
  search.value='11111';
  render();
  assert.match(select.innerHTML,/Adri/);
  assert.doesNotMatch(select.innerHTML,/Mary/);
});

test('empty workspace opens new-person form without a separate navigation',()=>{
  const code=section('function ntRenderPersonOptions(preferredId){','function ntStartForPerson(');
  const select={value:'',innerHTML:''},filter={value:''},hint={textContent:''},details={open:false};
  const elements={'nt-pac':select,'nt-person-filter':filter,'nt-person-hint':hint,
    'nt-person-create-details':details};
  const render=new Function('$','professionalCloudReady','CithelaCloud','DB','normalizePhone','escHtml',
    code+'\nreturn ntRenderPersonOptions;')(
      id=>elements[id],()=>true,{state:()=>({people:[]})},{p:()=>[]},
      v=>String(v||'').replace(/\D/g,''),v=>String(v));
  render();
  assert.equal(details.open,true);
  assert.match(hint.textContent,/Primera persona/);
  assert.match(select.innerHTML,/Elegí una persona/);
});

test('person list and cloud profile offer one-step booking shortcuts',()=>{
  const people=section('function renderPacs(){','async function cloudIssuePhoneInvite(');
  assert.match(people,/onclick="ntStartForPerson/);
  assert.match(people,/Ver ficha/);
  const ficha=section('async function cloudVerFicha(id){','async function crearPersona(){');
  assert.match(ficha,/closeM\('m-ficha'\);ntStartForPerson/);
});

test('post-save notice is explicit: WhatsApp still requires supervised operator action',()=>{
  const notice=section('function renderNtCreatedSummary(){','function ntDismissCreatedSummary(){');
  assert.match(notice,/WhatsApp todavía no enviado/);
  assert.match(notice,/Preparar WhatsApp/);
  assert.match(notice,/cloudOpenWhatsApp/);
  const draft=section('function cloudWhatsAppContent(t,pac,kind){','function closeCloudWhatsAppDraft(){');
  assert.match(draft,/pendiente de confirmación/);
  assert.match(draft,/Tu turno está confirmado/);
  assert.match(draft,/No necesitás crear una cuenta para recibir este aviso/);
  assert.doesNotMatch(draft,/Si ya tenés acceso, podés consultar/);
});


test('WhatsApp notice types are tied to the real appointment status',()=>{
  const code=section('let cloudWhatsAppDraft=null;','function whatsappAppointmentDateTime(');
  let version=1,tenant='tenant-A';
  const actions=new Function('cloudAppointmentRaw','professionalCloudReady','CithelaCloud',
    code+'\nreturn {kinds:cloudWhatsAppKinds,record:x=>cloudLastRescheduled=x};')(
      ()=>({row_version:version,deposit_status:null,deposit_amount_minor:0}),
      ()=>true,{state:()=>({tenant:{id:tenant}})}
    );
  const names=status=>actions.kinds(status,'appt-1').map(([key])=>key);
  assert.deepEqual(names('pendiente'),['booking','reminder']);
  assert.deepEqual(names('confirmado'),['confirmed','reminder']);
  assert.deepEqual(names('cancelado'),['cancelled']);
  actions.record({id:'appt-1',tenantId:'tenant-A',rowVersion:1});
  assert.ok(names('pendiente').includes('rescheduled'));
  version=2;
  assert.ok(!names('pendiente').includes('rescheduled'),'stale version removes reschedule notice');
  version=1;tenant='tenant-B';
  assert.ok(!names('pendiente').includes('rescheduled'),'other tenant cannot reuse reschedule');
});

test('WhatsApp defaults to the current state and not a manual ambiguous kind',()=>{
  const open=section('function cloudOpenWhatsApp(id,preset){','function refreshCloudWhatsAppDraft(){');
  assert.match(open,/const kind=kinds\.some\(\(\[k\]\)=>k===preset\)\?preset:kinds\[0\]\[0\]/);
  assert.doesNotMatch(open,/t\.estado==='pendiente'\?'':/);
  const reprogram=section('async function confirmReprogram(){','// ── PACIENTES');
  assert.match(reprogram,/command:'appointment\.reschedule'/);
  assert.match(reprogram,/cloudLastRescheduled=currentRaw/);
  assert.match(reprogram,/await CithelaCloud\.refresh\(\)/);
});
