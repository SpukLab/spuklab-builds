import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
const resumeStart=html.indexOf('const CITHELA_RETURN_PROFESSIONAL=');
const resumeEnd=html.indexOf('function professionalShowPilotSignUp(){',resumeStart);
const switchStart=html.indexOf('async function patientSwitchToProfessional(){');
const switchEnd=html.indexOf('async function logout(){',switchStart);
assert.ok(resumeStart>=0&&resumeEnd>resumeStart);
assert.ok(switchStart>=0&&switchEnd>switchStart);
const resumeCode=html.slice(resumeStart,resumeEnd);
const switchCode=html.slice(switchStart,switchEnd);

test('opening a cached professional session verifies membership before patient routing',async()=>{
  const initial={signedIn:true,membership:null,tenant:null,email:'pro@example.test'};
  const restored={signedIn:true,membership:{role:'owner'},tenant:{id:'clinic'},email:'pro@example.test'};
  let refreshes=0,patientCalls=0;const events=[];
  const cloud={
    state:()=>initial,
    refresh:async()=>{refreshes++;return restored;},
    patientPortal:async()=>{patientCalls++;return {profiles:[{name:'patient'}]};}
  };
  const make=new Function('location','CithelaCloud','setRole','goMed','scr','toast',
    'pendingPatientInvite','CITHELA_INVITE_FROM_LINK','showProfessionalPasswordRecovery',
    'loginWithCloudSession','patientEnter','sameInvitePhoneNumber','$','goPac',
    'showProfessionalWorkspaceSetup','renderPatientLoginSession',
    'let me={};let patientNoLinkedProfile=false;let patientPortalData=null;\n'+resumeCode+
    '\nreturn {resumeCloudSession,getMe:()=>me};');
  const app=make({search:''},cloud,v=>events.push('role:'+v),()=>events.push('professional'),
    page=>events.push('screen:'+page),msg=>events.push('toast:'+msg),()=>false,false,
    ()=>{},()=>{},()=>{},()=>false,()=>({value:''}),()=>events.push('patient'),
    ()=>{},()=>{});
  await app.resumeCloudSession();
  assert.equal(refreshes,1);
  assert.equal(patientCalls,0);
  assert.equal(app.getMe().role,'medico');
  assert.deepEqual(events,['role:medico','professional']);
});

function switchHarness(session){
  const events=[],fields={
    'patient-open-professional':{disabled:false},
    'l-cloud-email':{value:'patient@example.test'},
    'l-cloud-password':{value:'autofill'}
  };
  let signouts=0;
  const cloud={refresh:async()=>session,signOut:async()=>{signouts++;}};
  const make=new Function('$','CithelaCloud','setRole','goMed','scr','toast','hideVisiblePasswords',
    'let me={role:"paciente",cloud:true};let patientPortalRequest=0,patientSlotRequest=0,patientBookingRequest=0;'+
    'let patientBookingState={},patientRescheduleState={},patientPortalData={},patientNoLinkedProfile=false;'+
    'let patientWhatsappOtpSent=false,patientEnrollPending=null,patientEnrollBusy=false;'+
    'let patientLinkedPhonePending=null,patientLinkedPhoneBusy=false;'+
    'const patientSharedDrafts=new Map([["x",1]]),patientSharedOpen=new Set(["x"]);\n'+switchCode+
    '\nreturn {run:patientSwitchToProfessional,getMe:()=>me,getPortal:()=>patientPortalData};');
  const api=make(id=>fields[id],cloud,r=>events.push('role:'+r),
    ()=>events.push('professional'),r=>events.push('screen:'+r),
    msg=>events.push('toast:'+msg),()=>events.push('hide-passwords'));
  return {api,events,fields,get signouts(){return signouts;}};
}

test('patient portal shows only patient actions; professional login remains at the entry screen',()=>{
  const portal=html.slice(html.indexOf('<div id="screen-patient-cloud"'),html.indexOf('<details id="patient-enroll-panel"'));
  assert.doesNotMatch(portal,/id="patient-open-professional"|Ingresar como profesional|Si tu cuenta profesional es diferente/);
  assert.match(html,/id="rb-med"[^>]*>Profesional<\/button>/);
  assert.match(html,/id="professional-login-button"/);
});

test('switching to an existing professional membership does not sign out',async()=>{
  const f=switchHarness({signedIn:true,membership:{role:'owner'},tenant:{id:'clinic'},email:'pro@example.test'});
  await f.api.run();
  assert.equal(f.signouts,0);
  assert.equal(f.api.getMe().role,'medico');
  assert.deepEqual(f.events,['role:medico','professional']);
  assert.equal(f.fields['patient-open-professional'].disabled,false);
});

test('switching from a patient-only identity locally signs out and opens professional login',async()=>{
  const f=switchHarness({signedIn:true,membership:null,tenant:null,error:null});
  await f.api.run();
  assert.equal(f.signouts,1);
  assert.equal(f.api.getMe().role,undefined);
  assert.equal(f.api.getPortal(),null);
  assert.ok(f.events.includes('role:medico'));
  assert.ok(f.events.includes('screen:login'));
  assert.equal(f.fields['l-cloud-email'].value,'');
  assert.equal(f.fields['l-cloud-password'].value,'');
});

test('a failed workspace check must not sign out an existing patient',async()=>{
  const f=switchHarness({signedIn:true,membership:null,tenant:null,error:'network_error'});
  await f.api.run();
  assert.equal(f.signouts,0);
  assert.equal(f.api.getMe().role,'paciente');
  assert.ok(f.events.some(x=>x.includes('No se pudo comprobar la sesión')));
});
