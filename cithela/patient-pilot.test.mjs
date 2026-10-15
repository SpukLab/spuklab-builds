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
function simulateLogin({phone='',email='',invited=false,signedIn=false,sessionEmail='',membership=null,unlinked=false}={}){
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
   'pendingPatientInvite','CITHELA_PHONE_OTP_ENABLED','role','patientWhatsappOtpSent','patientNoLinkedProfile',
    login+'\nreturn renderPatientLoginSession;')(
      id=>refs[id],{state:()=>({signedIn,email:sessionEmail,phone:'',membership})},
      ()=>email,()=>phone,()=>invited?'abc':'',false,'paciente',false,unlinked);
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

test('verified session without patient link identifies account and does not imply WhatsApp delivery',()=>{
 const r=simulateLogin({signedIn:true,sessionEmail:'other@example.org',unlinked:true});
 assert.equal(r['patient-primary-access'].textContent,'Comprobar mis turnos nuevamente');
 assert.match(r['patient-session-state'].textContent,/other@example.org/);
 assert.match(r['patient-access-copy'].textContent,/no tiene una ficha de paciente vinculada/i);
 assert.match(r['patient-invite-hint'].textContent,/No se envió ningún mensaje nuevo/);
 assert.ok(!r['patient-session-state'].textContent.includes('Acceso verificado.'));
});
test('professional session is identified before trying a patient-only portal',()=>{
 const r=simulateLogin({signedIn:true,sessionEmail:'operator@example.org',membership:{role:'owner'}});
 assert.match(r['patient-session-state'].textContent,/acceso profesional/);
 assert.equal(r['patient-primary-access'].textContent,'Ver mis turnos');
});
test('switching accounts clears the previous account email and stale unlinked warning',()=>{
 assert.match(script,/patientNoLinkedProfile=false;\s+if\(\$\('l-patient-email'\)\)\$\('l-patient-email'\)\.value=pendingPatientInviteEmail\(\)\|\|''/);
 assert.match(script,/if\(!result\.profiles\?\.length\)\{\s+patientNoLinkedProfile=true;/);
 assert.match(script,/if\(result\?\.profiles\?\.length\)\{\s+patientNoLinkedProfile=false;/);
});

const magicHelpers=extract('let patientMagicLinkSending=false;', 'function togglePatientDemo(){');
const magicSend=extract('async function patientSendMagicLink(){', 'async function patientEnter(){');
function createMagicLinkHarness({email='patient@example.com',send=async()=>({})}={}){
  const els={'l-patient-email':{value:email},'patient-primary-access':{disabled:false}};
  let attempts=0;
  const messages=[];
  const localStore=new Map();
  const storage={getItem:key=>localStore.get(key)||null,setItem:(key,value)=>localStore.set(key,value)};
  const auth={state:()=>({signedIn:false,email:''}),sendPatientMagicLink:async value=>{attempts++;return send(value);}};
  const setup=new Function('$','CithelaCloud','renderPatientLoginSession','toast','localStorage',
    magicHelpers+'\n'+magicSend+'\nreturn {send:patientSendMagicLink,until:patientMagicLinkNextAllowedAt};');
  const session=setup(id=>els[id],auth,()=>{els['patient-primary-access'].disabled=false;},
    (message)=>messages.push(message),storage);
  return {...session,els,messages,get attempts(){return attempts;}};
}
test('email project rate limit is presented as a clear message and prevents immediate repeat',async()=>{
 const h=createMagicLinkHarness({send:async()=>{throw Object.assign(new Error('email rate limit exceeded'),{code:'over_email_send_rate_limit'});}});
 await h.send();
 assert.equal(h.attempts,1);
 assert.match(h.messages.at(-1),/límite de correos/i);
 assert.match(h.messages.at(-1),/No se envió otro enlace/i);
 assert.ok(h.until()>Date.now());
 await h.send();
 assert.equal(h.attempts,1);
});
test('patient email success rate guards duplicate requests without leaving submit disabled',async()=>{
 const h=createMagicLinkHarness();
 await h.send();
 assert.equal(h.attempts,1);
 assert.equal(h.els['patient-primary-access'].disabled,false);
 await h.send();
 assert.equal(h.attempts,1);
 assert.match(h.messages.at(-1),/Ya se solicitó/);
});
test('patient email invalid address never triggers Supabase call',async()=>{
 const h=createMagicLinkHarness({email:'not-an-email'});
 await h.send();
 assert.equal(h.attempts,0);
 assert.match(h.messages.at(-1),/correo válido/i);
});
test('concurrent email clicks call the backend only once',async()=>{
 let release;const wait=new Promise(r=>{release=r;});
 const h=createMagicLinkHarness({send:async()=>wait});
 const one=h.send(),two=h.send();
 assert.equal(h.attempts,1);
 release();
 await Promise.all([one,two]);
 assert.equal(h.attempts,1);
});
test('rate limit message never claims a new email was delivered',()=>{
 const g=new Function(magicHelpers+'\nreturn patientMagicLinkErrorMessage;')();
 assert.match(g({message:'429: email rate limit exceeded'}),/No se envió otro enlace/);
 assert.match(g({message:'For security purposes, you can only request this after 31 seconds.'}),/Por seguridad/);
});
