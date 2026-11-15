import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
const start=html.indexOf('const CITHELA_RETURN_PROFESSIONAL=');
const end=html.indexOf('function professionalShowPilotSignUp(){',start);
assert.ok(start>=0&&end>start);
const flow=html.slice(start,end);

function fixture(profiles=[],search=''){
  const roles=[],events=[],fields={'l-patient-email':{value:''}};
  const session={signedIn:true,email:'invited@example.test',membership:null,tenant:null};
  const cloud={state:()=>session,refresh:async()=>session,
    patientPortal:async()=>({profiles})};
  const make=new Function('location','CithelaCloud','setRole','showProfessionalPasswordRecovery',
    'pendingPatientInvite','CITHELA_INVITE_FROM_LINK','CITHELA_SECOND_TENANT_PILOT',
    'loginWithCloudSession','patientEnter','sameInvitePhoneNumber','goMed','scr','toast',
    'showProfessionalWorkspaceSetup','$','goPac','renderPatientLoginSession',
    'let me={};let patientNoLinkedProfile=false;let patientPortalData=null;\n'+flow+
    '\nreturn {resumeCloudSession,getMe:()=>me,getNoProfile:()=>patientNoLinkedProfile};');
  const app=make({search},cloud,r=>roles.push(r),()=>{},()=>false,false,
    search.includes('pilotTenant=1'),()=>events.push('login'),()=>{},()=>false,
    ()=>events.push('goMed'),()=>{},()=>{},()=>events.push('setup'),
    id=>fields[id],()=>events.push('goPac'),()=>events.push('patientLogin'));
  return {app,roles,events};
}

test('invited professional with no membership or patient profile opens professional setup',async()=>{
  const f=fixture();
  await f.app.resumeCloudSession();
  assert.deepEqual(f.roles,['medico']);
  assert.deepEqual(f.events,['setup']);
  assert.equal(f.app.getNoProfile(),false);
});
test('professional setup survives loss of the pilotTenant query parameter',async()=>{
  const f=fixture([],'?pilotTenant=1');
  await f.app.resumeCloudSession();
  assert.deepEqual(f.roles,['medico']);
  assert.ok(f.events.includes('setup'));
});
test('existing linked patient still opens patient portal',async()=>{
  const f=fixture([{name:'Persona',tenant_id:'tenant-A'}]);
  await f.app.resumeCloudSession();
  assert.deepEqual(f.roles,['paciente']);
  assert.ok(f.events.includes('goPac'));
  assert.ok(!f.events.includes('setup'));
  assert.equal(f.app.getMe().role,'paciente');
});
test('workspace creation continues to enforce patient exclusion and server authorization',()=>{
  const setup=html.slice(html.indexOf('function showProfessionalWorkspaceSetup(){'),
    html.indexOf('async function professionalCancelPilotWorkspace(){'));
  const create=html.slice(html.indexOf('async function professionalCreatePilotWorkspace(){'),
    html.indexOf('function showProfessionalPasswordRecovery(){'));
  assert.doesNotMatch(setup,/CITHELA_SECOND_TENANT_PILOT/);
  assert.match(create,/await CithelaCloud\.patientPortal\(\)/);
  assert.match(create,/await CithelaCloud\.bootstrap\(name\)/);
  assert.match(create,/patient_account_not_eligible/);
  assert.match(create,/onboarding_not_authorized/);
});