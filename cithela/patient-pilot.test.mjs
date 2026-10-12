import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const html=await readFile(new URL('./index.html',import.meta.url),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script,'Expected main JS script');
const extract=(start,end)=>{
 const from=script.indexOf(start),to=script.indexOf(end,from+start.length);
 assert.ok(from>=0&&to>from,'Missing JS boundaries: '+start);
 return script.slice(from,to);
};
const login=extract('function renderPatientLoginSession(){','async function patientSwitchAccount(){');
const primary=extract('async function patientPrimaryAccess(){','async function patientVerifyWhatsAppOtp(){');
const professional=extract('async function cloudIssuePhoneInvite(personId){','function sharePatientPhoneInviteWhatsApp(personId){');
const ficha=extract('let cloudFichaRequest=0;','async function crearPersona(){');
function simulateLogin({phone='',email='',invited=false}={}){
 const refs={
  'patient-session-state':{style:{},textContent:''},
  'patient-switch-account':{style:{}},
  'patient-invite-hint':{textContent:''},
  'l-patient-email':{value:''},
  'patient-email-wrap':{hidden:false},
  'patient-access-copy':{textContent:''},
  'patient-primary-access':{textContent:'',disabled:false},
  'patient-whatsapp-otp':{style:{}}
 };
 const run=new Function('$','CithelaCloud','pendingPatientInviteEmail','pendingPatientInvitePhone',
   'pendingPatientInvite','CITHELA_PHONE_OTP_ENABLED','role','patientWhatsappOtpSent',
    login+'\nreturn renderPatientLoginSession;')(
      id=>refs[id],{state:()=>({signedIn:false,email:'',phone:''})},
      ()=>email,()=>phone,()=>invited?'abc':'',false,'paciente',false);
 run();return refs;
}
test('pilot explicitly prevents broken phone OTP enrollment',()=>{
 assert.match(script,/const CITHELA_PHONE_OTP_ENABLED=false;/);
 assert.match(primary,/if\(!CITHELA_PHONE_OTP_ENABLED\)/);
 assert.match(professional,/if\(!CITHELA_PHONE_OTP_ENABLED\)/);
 const r=simulateLogin({phone:'+5492215723664',invited:true});
 assert.equal(r['patient-primary-access'].disabled,true);
 assert.match(r['patient-invite-hint'].textContent,/invitación.*correo/i);
 assert.equal(r['patient-whatsapp-otp'].style.display,'none');
});
test('email invitation still offers email link, prefilled with intended recipient',()=>{
 const r=simulateLogin({email:'pilot@example.org',invited:true});
 assert.equal(r['patient-primary-access'].disabled,false);
 assert.equal(r['patient-primary-access'].textContent,'Continuar');
 assert.equal(r['l-patient-email'].value,'pilot@example.org');
});
test('professional account now exposes email invite instead of unusable phone invite',()=>{
 assert.match(ficha,/Acceso del paciente · piloto/);
 assert.match(ficha,/Preparar invitación por correo/);
 assert.doesNotMatch(ficha,/onclick="cloudIssuePhoneInvite/);
 assert.match(script,/Compartir invitación por WhatsApp/);
});
test('patient booking remains authenticated and server-authoritative',()=>{
 assert.match(script,/async function patientBookingCreate\(/);
 assert.match(script,/c\.rpc\('cithela_patient_booking_create'/);
 assert.match(script,/function patientBookingProfile\(/);
 assert.match(script,/patientBookingProfile\(s\.tenantId,s\.personId\)/);
});
