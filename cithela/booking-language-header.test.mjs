import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
const start=html.indexOf('let professionalBookingLocale=');
const end=html.indexOf('let healthShortcutTenant=null;',start);
assert.ok(start>0&&end>start);
const source=html.slice(start,end);
function setup({role='owner',initial='es',failSave=false}={}){
  const user={tenant:{id:'tenant-one'},membership:{role}};
  let locale=initial;
  const saved=[];
  const buttons={};
  for(const lang of ['es','en']){
    buttons[lang]={disabled:true,attributes:{},setAttribute(k,v){this.attributes[k]=v}};
  }
  const status={hidden:true,textContent:'',style:{}};
  const elements={
    'professional-booking-language':{value:'',disabled:true},
    'professional-booking-language-settings':{hidden:role==='operator'},
    'professional-booking-language-es':buttons.es,
    'professional-booking-language-en':buttons.en,
    'professional-booking-language-status':status,
    'professional-quick-actions':{hidden:true},
    'professional-public-booking-shortcut':{hidden:true}
  };
  const env={
    $:name=>elements[name]||null,
    CithelaCloud:{
      state:()=>user,
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
  return {env,elements,buttons,status,user,saved,locale:()=>locale};
}
const flush=async()=>{await new Promise(resolve=>setImmediate(resolve))};

test('owner sees ES/EN even without public share link and saves changed booking language',async()=>{
  const f=setup();
  f.env.updateProfessionalQuickActions();
  assert.equal(f.elements['professional-quick-actions'].hidden,false);
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

test('operator cannot write booking language or use hidden language shortcuts',async()=>{
  const f=setup({role:'operator'});
  await f.env.loadProfessionalBookingLanguage('tenant-one');
  assert.equal(f.buttons.en.disabled,true);
  f.env.chooseProfessionalBookingLanguage('en');
  await flush();
  assert.deepEqual(f.saved,[]);
  assert.equal(f.locale(),'es');
  f.env.updateProfessionalQuickActions();
  assert.equal(f.elements['professional-quick-actions'].hidden,true);
});

test('failed save restores language without implying success',async()=>{
  const f=setup({failSave:true});
  await f.env.loadProfessionalBookingLanguage('tenant-one');
  f.env.chooseProfessionalBookingLanguage('en');
  await flush();
  assert.deepEqual(f.saved,[]);
  assert.equal(f.elements['professional-booking-language'].value,'es');
  assert.equal(f.buttons.es.attributes['aria-pressed'],'true');
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
  assert.match(html,/Idioma reservas/);
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
