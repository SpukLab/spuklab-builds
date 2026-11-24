import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
const start=html.indexOf('let professionalBookingLocale=');
const end=html.indexOf('let healthShortcutTenant=null;',start);
assert.ok(start>0&&end>start);
const source=html.slice(start,end);
function setup({role='owner',initial='es',failSave=false,shareEnabled=false,shareUrl='',shareFails=false}={}){
  const user={tenant:{id:'tenant-one'},membership:{role}};
  let locale=initial;
  const saved=[];
  const buttons={};
  for(const lang of ['es','en']){
    buttons[lang]={disabled:true,attributes:{},setAttribute(k,v){this.attributes[k]=v}};
  }
  const status={hidden:true,textContent:'',style:{}};
  let uiLocale='es';
  const uiButtons=[];
  const elements={
    'professional-booking-language':{value:'',disabled:true},
    'professional-booking-language-settings':{hidden:false},
    'professional-booking-language-es':buttons.es,
    'professional-booking-language-en':buttons.en,
    'professional-booking-language-status':status,
    'professional-quick-actions':{hidden:true},
    'professional-public-booking-shortcut':{hidden:true},
    'professional-share-copy':{disabled:true},
    'professional-share-native':{disabled:true},
    'professional-share-qr':{href:'',textContent:''},
    'professional-share-description':{textContent:''}
  };
  const env={
    $:name=>elements[name]||null,
    window:{CithelaUiLocale:{get:()=>uiLocale,set:lang=>{uiLocale=lang},hasPreference:()=>true}},
    document:{querySelectorAll:()=>uiButtons},
    CithelaCloud:{
      state:()=>user,
      professionalBookingShare:async()=>{if(shareFails)throw Error('offline');return {enabled:shareEnabled,url:shareUrl}},
      publicBookingConfig:async next=>{
        if(next===undefined)return {locale};
        if(failSave)throw Error('simulated_save_failure');
        saved.push(next);locale=next;return {locale};
      }
    },
    professionalCloudReady:()=>!!user.tenant,
    toast:()=>{},navigator:{},console,
  };
  vm.createContext(env);
  vm.runInContext(source,env,{filename:'CITHELA professional locale'});
  return {env,elements,buttons,status,user,saved,locale:()=>locale,uiLocale:()=>uiLocale};
}
const flush=async()=>{await new Promise(resolve=>setImmediate(resolve))};

test('owner sees ES/EN even without public share link and saves changed booking language',async()=>{
  const f=setup();
  f.env.updateProfessionalBookingShareVisibility();
  assert.equal(f.elements['professional-quick-actions'].hidden,false);
  assert.equal(f.elements['professional-public-booking-shortcut'].hidden,false);
  await f.env.loadProfessionalBookingLanguage('tenant-one');
  assert.equal(f.buttons.es.attributes['aria-pressed'],'true');
  assert.equal(f.buttons.en.attributes['aria-pressed'],'false');
  assert.equal(f.buttons.es.disabled,false);
  f.env.chooseProfessionalBookingLanguage('en');
  await flush();
  assert.deepEqual(f.saved,['en']);
  assert.equal(f.locale(),'en');
  assert.equal(f.buttons.en.attributes['aria-pressed'],'true');
  assert.equal(f.buttons.es.attributes['aria-pressed'],'false');
  assert.equal(f.buttons.en.disabled,false);
});

test('operator can translate own workspace without changing public booking default',async()=>{
  const f=setup({role:'operator'});
  await f.env.loadProfessionalBookingLanguage('tenant-one');
  assert.equal(f.buttons.en.disabled,false);
  f.env.chooseProfessionalBookingLanguage('en');
  await flush();
  assert.deepEqual(f.saved,[]);
  assert.equal(f.locale(),'es');
  assert.equal(f.uiLocale(),'en');
  f.env.updateProfessionalBookingShareVisibility();
  assert.equal(f.elements['professional-quick-actions'].hidden,false);
  assert.equal(f.elements['professional-public-booking-shortcut'].hidden,false);
  assert.equal(f.elements['professional-share-copy'].disabled,true);
});

test('share section is visible when public bookings are disabled; copy/share remain locked',async()=>{
  const f=setup();
  await f.env.loadProfessionalBookingShare('tenant-one');
  assert.equal(f.elements['professional-public-booking-shortcut'].hidden,false);
  assert.equal(f.elements['professional-share-copy'].disabled,true);
  assert.equal(f.elements['professional-share-native'].disabled,true);
  assert.match(f.elements['professional-share-description'].textContent,/Sin enlace activo/);
  assert.equal(f.elements['professional-share-qr'].href,'./compartir.html?tenant=tenant-one');
  assert.equal(f.elements['professional-share-qr'].textContent,'QR / configurar');
});

test('only server-confirmed active link enables copy/share',async()=>{
  const url='https://spuklab.github.io/spuklab-builds/cithela/reservar.html?c=alma-pampa';
  const enabled=setup({shareEnabled:true,shareUrl:url});
  await enabled.env.loadProfessionalBookingShare('tenant-one');
  assert.equal(enabled.elements['professional-share-copy'].disabled,false);
  assert.equal(enabled.elements['professional-share-native'].disabled,false);
  assert.equal(enabled.elements['professional-share-qr'].textContent,'Ver QR');
  const notEnabled=setup({shareEnabled:false,shareUrl:url});
  await notEnabled.env.loadProfessionalBookingShare('tenant-one');
  assert.equal(notEnabled.elements['professional-share-copy'].disabled,true);
});

test('share lookup failure does not hide link/QR entry or invent a public URL',async()=>{
  const f=setup({shareFails:true});
  await f.env.loadProfessionalBookingShare('tenant-one');
  assert.equal(f.elements['professional-public-booking-shortcut'].hidden,false);
  assert.equal(f.elements['professional-share-copy'].disabled,true);
  assert.match(f.elements['professional-share-description'].textContent,/No se pudo consultar/);
  f.user.tenant=null;
  f.env.updateProfessionalBookingShareVisibility();
  assert.equal(f.elements['professional-public-booking-shortcut'].hidden,true);
});

test('failed save restores language without implying success',async()=>{
  const f=setup({failSave:true});
  await f.env.loadProfessionalBookingLanguage('tenant-one');
  f.env.chooseProfessionalBookingLanguage('en');
  await flush();
  assert.deepEqual(f.saved,[]);
  assert.equal(f.elements['professional-booking-language'].value,'es');
  assert.equal(f.buttons.en.attributes['aria-pressed'],'true');
  assert.equal(f.uiLocale(),'en');
  assert.match(f.status.textContent,/No se pudo guardar el idioma/);
});

test('switch does not change accounts or write an unverified language',async()=>{
  const f=setup();
  await f.env.loadProfessionalBookingLanguage('tenant-one');
  f.env.chooseProfessionalBookingLanguage('fr');
  assert.deepEqual(f.saved,[]);
  f.user.tenant={id:'tenant-other'};
  f.env.chooseProfessionalBookingLanguage('en');
  await flush();
  assert.deepEqual(f.saved,[]);
  assert.equal(f.locale(),'es');
});

test('mobile layout and simplified settings preserve necessary links and technical diagnostics',()=>{
  assert.match(html,/id="professional-booking-language-settings" class="cithela-locale-quick"/);
  assert.match(html,/id="professional-booking-language-es"/);
  assert.match(html,/id="professional-booking-language-en"/);
  assert.match(html,/Idioma de la interfaz y reservas/);
  assert.match(html,/ui-locale\.js/);
  assert.match(html,/id="professional-booking-language-settings"[\s\S]*?Idioma<\/span>/);
  const nav=html.slice(html.indexOf('id="screen-medico"'),html.indexOf('<div class="professional-tabbar">'));
  assert.ok(nav.indexOf('id="professional-booking-language-settings"')<nav.indexOf('class="nav-out" onclick="logout()"'));
  assert.ok(nav.indexOf('id="professional-public-booking-shortcut"')>nav.indexOf('</nav>'));
  assert.match(nav,/id="professional-share-qr"/);
  assert.match(nav,/QR \/ configurar/);
  const sharePage=readFileSync(new URL('./compartir.html',import.meta.url),'utf8');
  assert.match(sharePage,/requestedTenant&&memberRoles\.has\(requestedTenant\)/);
  assert.match(html,/function syncProfessionalBookingLanguageButtons/);
  assert.match(html,/id="cfg-section-resources" hidden/);
  assert.match(html,/resourceGroup\.hidden=cloud&&list\.length<=1/);
  assert.match(html,/id="professional-health-settings"/);
  assert.doesNotMatch(html,/<div class="block-main"><div class="block-title">Backend Supabase/);
  assert.doesNotMatch(html,/Contraseña Supabase/);
  const accountStart=html.indexOf('id="cfg-section-cloud"');
  const diagnostic=html.indexOf('id="cfg-section-infrastructure"');
  const accountClose=html.indexOf('id="cfg-section-security"');
  assert.ok(accountStart>=0&&diagnostic>accountStart&&diagnostic<accountClose);
  assert.doesNotMatch(html,/id="cfg-section-public-booking"/);
});
