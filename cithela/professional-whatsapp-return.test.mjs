import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
const accessHtml=readFileSync(new URL('./acceso-whatsapp.html',import.meta.url),'utf8');
const accessPage=readFileSync(new URL('./commercial/professional-whatsapp-page.js',import.meta.url),'utf8');
const start=html.indexOf('const CITHELA_RETURN_PROFESSIONAL=');
const end=html.indexOf('function professionalShowPilotSignUp(){',start);
assert.ok(start>=0&&end>start);
const code=html.slice(start,end);

function fixture({first={signedIn:true,membership:null,tenant:null},updates=[
  {signedIn:true,membership:{role:'owner'},tenant:{id:'tenant-A'},email:'pro@example.invalid'}],
  search='?returnTo=professional'}={}){
  let current=first,refreshes=0,patientCalls=0;
  const events=[],identity={role:null};
  const cloud={
    state:()=>current,
    refresh:async()=>{current=updates[Math.min(refreshes,updates.length-1)];refreshes++;return current;},
    patientPortal:async()=>{patientCalls++;return {profiles:[{tenant_id:'test'}]}}
  };
  const create=new Function('location','CithelaCloud','setRole','goMed','scr','toast',
    'pendingPatientInvite','CITHELA_INVITE_FROM_LINK','showProfessionalPasswordRecovery',
    'CITHELA_SECOND_TENANT_PILOT',
    'loginWithCloudSession','patientEnter','sameInvitePhoneNumber','$','goPac',
    'let me={};let patientNoLinkedProfile=false;let patientPortalData=null;\n'+code+
    '\nreturn {resumeCloudSession,getMe:()=>me};');
  const api=create({search},cloud,role=>{identity.role=role;events.push('role:'+role);},
    ()=>events.push('goMed'),page=>events.push('screen:'+page),
    msg=>events.push('toast:'+msg),()=>false,false,
    ()=>events.push('passwordRecovery'),false,
    ()=>events.push('legacy-login'),()=>events.push('patientEnter'),()=>false,
    ()=>({value:'',textContent:''}),()=>events.push('goPac'));
  return {api,events,identity,stats:()=>({refreshes,patientCalls})};
}
test('the professional return page has a directed return path without session logout',()=>{
  assert.match(accessHtml,/href="\.\/\?returnTo=professional"/);
  assert.match(accessHtml,/Volver a mi agenda profesional/);
  assert.match(accessHtml,/id="access-title"/);
  assert.match(accessPage,/Vinculá tu WhatsApp/);
  assert.match(accessPage,/Asociá tu número a esta misma cuenta profesional/);
  assert.doesNotMatch(accessPage,/(?:\.auth\.)?signOut\(/);
  assert.match(accessHtml,/auth-captcha\.js\?v=20261112-login-fix/);
});
test('professional return restores the actual verified membership, not a patient portal',async()=>{
  const f=fixture();
  await f.api.resumeCloudSession();
  assert.equal(f.api.getMe().role,'medico');
  assert.equal(f.api.getMe().cloud,true);
  assert.ok(f.events.includes('goMed'));
  assert.equal(f.identity.role,'medico');
  assert.equal(f.stats().patientCalls,0);
  assert.equal(f.stats().refreshes,1);
});
test('one incomplete workspace refresh gets a bounded second chance before routing',async()=>{
  const f=fixture({updates:[
    {signedIn:true,membership:null,tenant:null},
    {signedIn:true,membership:{role:'owner'},tenant:{id:'tenant-A'},email:'pro@example.invalid'}]});
  await f.api.resumeCloudSession();
  assert.equal(f.stats().refreshes,2);
  assert.equal(f.api.getMe().role,'medico');
  assert.equal(f.stats().patientCalls,0);
});
test('persisting missing membership never becomes a patient session and never signs out',async()=>{
  const f=fixture({updates:[{signedIn:true,membership:null,tenant:null,email:'pro@example.invalid'}]});
  await f.api.resumeCloudSession();
  assert.ok(!f.events.includes('goMed'));
  assert.ok(!f.events.includes('goPac'));
  assert.ok(f.events.includes('screen:login'));
  assert.equal(f.stats().patientCalls,0);
  assert.equal(f.identity.role,'medico');
  assert.ok(f.events.some(x=>x.includes('no pudimos recuperar tu agenda profesional')));
});
test('expired professional return only shows login with no cross-account role escalation',async()=>{
  const f=fixture({updates:[{signedIn:false,membership:null,tenant:null}]});
  await f.api.resumeCloudSession();
  assert.equal(f.stats().patientCalls,0);
  assert.equal(f.identity.role,'medico');
  assert.ok(f.events.some(x=>x.includes('Ingresá con tu correo y contraseña')));
  assert.equal(f.api.getMe().role,undefined);
});
