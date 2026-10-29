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
      ()=>email,()=>phone,()=>invited?'abc':'',true,'paciente',false,unlinked);
 run();return refs;
}
test('supervised WhatsApp-first invitation requests OTP only for the bound invite number',()=>{
 assert.match(script,/const CITHELA_PHONE_OTP_ENABLED=true;/);
 assert.match(primary,/if\(!CITHELA_PHONE_OTP_ENABLED\)/);
 assert.match(professional,/if\(!CITHELA_PHONE_OTP_ENABLED\)/);
 const r=simulateLogin({phone:'+5492215723664',invited:true});
 assert.equal(r['patient-primary-access'].disabled,false);
 assert.match(r['patient-primary-access'].textContent,/Enviar código por WhatsApp/);
 assert.match(r['patient-invite-hint'].textContent,/mismo número/i);
 assert.equal(r['patient-whatsapp-otp'].style.display,'none');
});
test('email invitation still offers email link, prefilled with intended recipient',()=>{
 const r=simulateLogin({email:'pilot@example.org',invited:true});
 assert.equal(r['patient-primary-access'].disabled,false);
 assert.equal(r['patient-primary-access'].textContent,'Continuar');
 assert.equal(r['l-patient-email'].value,'pilot@example.org');
});
test('professional can prepare a phone-first invite and retains alternative email invitation',()=>{
 assert.match(ficha,/Acceso del paciente · piloto/);
 assert.match(ficha,/Preparar invitación por WhatsApp/);
 assert.match(ficha,/Preparar invitación por correo/);
 assert.match(ficha,/onclick="cloudIssuePhoneInvite/);
 assert.match(script,/Compartir invitación por WhatsApp/);
 assert.match(script,/CITHELA verificará tu número con un código de 6 dígitos/);
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
 assert.match(h.messages.at(-1),/No se envió otro enlace/);
});
test('Supabase short per-address cooldown is not confused with hourly email quota',async()=>{
 const h=createMagicLinkHarness({send:async()=>{
   throw Object.assign(new Error('For security purposes, you can only request this after 27 seconds.'),{code:'over_email_send_rate_limit'});
 }});
 const started=Date.now();
 await h.send();
 assert.equal(h.attempts,1);
 assert.match(h.messages.at(-1),/Por seguridad/);
 assert.match(h.messages.at(-1),/No se envió otro enlace/);
 const remaining=h.until()-started;
 assert.ok(remaining>=27000&&remaining<=40000,'Short email cooldown must not become 10 minutes');
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

const whatsappOtpSignIn=extract('  async function sendPatientWhatsAppOtp(phone){','  async function verifyPatientPhoneOtp(phone,token){');
function makeOtpFunction({enabled=true}={}){
 const calls=[];
 const fn=new Function('getClient','CITHELA_PHONE_OTP_ENABLED',whatsappOtpSignIn+'\nreturn sendPatientWhatsAppOtp;')(
   async()=>({auth:{signInWithOtp:async x=>{calls.push(x);return {error:null};}}}),enabled);
 return {fn,calls};
}
test('Meta Cloud API OTP uses Supabase SMS Hook (not Twilio WhatsApp channel)',async()=>{
 const {fn,calls}=makeOtpFunction();
 const result=await fn('+5492215723664');
 assert.deepEqual(result,{ok:true,phone:'+5492215723664'});
 assert.deepEqual(calls,[{phone:'+5492215723664',options:{channel:'sms',shouldCreateUser:true}}]);
});
test('phone OTP remains disabled until approved Meta AUTHENTICATION template',async()=>{
 const {fn,calls}=makeOtpFunction({enabled:false});
 await assert.rejects(fn('+5492215723664'),/otp_whatsapp_no_disponible/);
 assert.equal(calls.length,0);
});
test('invalid phone never triggers Meta OTP transport',async()=>{
 const {fn,calls}=makeOtpFunction();
 await assert.rejects(fn('not-phone'),/WhatsApp inválido/);
 assert.equal(calls.length,0);
});
test('OTP verification uses Supabase phone SMS type',()=>{
 const source=extract('  async function verifyPatientPhoneOtp(phone,token){','  async function issuePatientPhoneInvite(');
 assert.match(source,/verifyOtp\(\{phone:clean,token:code,type:'sms'\}\)/);
});

const phoneEnrollFns=extract('  async function enrollExistingPatientPhone(phone){','  async function issuePatientPhoneInvite(');
function enrollmentHarness({profiles=[{person_id:'patient'}],userId='existing-user'}={}){
 let user={id:userId,email:'patient@example.test',email_confirmed_at:'2026-10-28T00:00:00Z',phone:''};
 const calls=[];
 const client={auth:{
  getUser:async()=>({data:{user},error:null}),
  updateUser:async({phone})=>{calls.push({op:'updateUser',phone});return {error:null};},
  verifyOtp:async({phone,token,type})=>{
   calls.push({op:'verifyOtp',phone,token,type});
   user={...user,phone,phone_confirmed_at:'2026-10-28T20:00:00Z'};
   return {error:null};
  }
 }};
 const fn=new Function('getClient','patientPortal','refresh',phoneEnrollFns+
   '\nreturn {start:enrollExistingPatientPhone,confirm:confirmExistingPatientPhone};')(
     async()=>client,async()=>({profiles}),async()=>({signedIn:true}));
 return {...fn,calls,swapUser:next=>{user={...user,...next}}};
}
test('enrollment sends phone_change rather than creating another Auth account',async()=>{
 const h=enrollmentHarness();
 const start=await h.start('+5492211234567');
 assert.equal(start.userId,'existing-user');
 assert.deepEqual(h.calls,[{op:'updateUser',phone:'+5492211234567'}]);
 const result=await h.confirm('+5492211234567','123456',start.userId);
 assert.equal(result.userId,start.userId);
 assert.equal(result.phone,'+5492211234567');
 assert.equal(h.calls[1].type,'phone_change');
});
test('patient profile membership is required before enrolling a phone',async()=>{
 const h=enrollmentHarness({profiles:[]});
 await assert.rejects(h.start('+5492211234567'),/patient_profile_required/);
 assert.equal(h.calls.length,0);
});
test('a changed user identity aborts verification without requesting a code',async()=>{
 const h=enrollmentHarness();
 const start=await h.start('+5492211234567');
 h.swapUser({id:'unexpected-user'});
 await assert.rejects(h.confirm('+5492211234567','123456',start.userId),/identity_changed/);
 assert.equal(h.calls.length,1);
});
test('existing accounts can still enroll phone securely while supervised invites are enabled',()=>{
 assert.match(script,/const CITHELA_PHONE_OTP_ENABLED=true;/);
 assert.match(html,/id="patient-enroll-panel"/);
 assert.match(html,/aria-describedby="patient-enroll-hint"/);
 assert.match(script,/phone_change/);
 assert.match(script,/shouldCreateUser:false/);
});

const linkedPhoneSource=extract('  async function sendLinkedPatientPhoneOtp(phone){','  async function enrollExistingPatientPhone(phone){');
test('linked WhatsApp login never creates a new Supabase user',async()=>{
 const sent=[];
 let verified=false;
 const fake={auth:{
  signInWithOtp:async x=>{sent.push(x);return {error:null};},
  verifyOtp:async x=>{verified=true;assert.equal(x.type,'sms');return {error:null};},
  getUser:async()=>({data:{user:{id:'existing',phone:'+5492211234567',phone_confirmed_at:'2026-10-28T00:00:00Z'}},error:null})
 }};
 const fn=new Function('getClient','patientPortal','refresh',linkedPhoneSource+
   '\nreturn {send:sendLinkedPatientPhoneOtp,verify:verifyLinkedPatientPhoneOtp};')(
     async()=>fake,async()=>({profiles:[{person_id:'patient'}]}),async()=>({signedIn:true}));
 await fn.send('+5492211234567');
 assert.deepEqual(sent,[{phone:'+5492211234567',options:{channel:'sms',shouldCreateUser:false}}]);
 await fn.verify('+5492211234567','123456');
 assert.equal(verified,true);
});
test('phone OTP login cannot access portal without matching patient link',async()=>{
 let signOuts=0;
 const fake={auth:{
  verifyOtp:async()=>({error:null}),
  getUser:async()=>({data:{user:{id:'otp-lab',phone:'+5492211234567',phone_confirmed_at:'2026-10-28T00:00:00Z'}},error:null}),
  signOut:async()=>{signOuts++;return {error:null}}
 }};
 const fn=new Function('getClient','patientPortal','refresh',linkedPhoneSource+
   '\nreturn verifyLinkedPatientPhoneOtp;')(
     async()=>fake,async()=>({profiles:[]}),async()=>({signedIn:false}));
 await assert.rejects(fn('+5492211234567','123456'),/patient_profile_required/);
 assert.equal(signOuts,1);
});

const invitationPhoneCompare=extract('function sameInvitePhoneNumber(invited,verified){','function clearPendingPatientInvite(){');
const sameInvitePhoneNumber=new Function(invitationPhoneCompare+'\nreturn sameInvitePhoneNumber;')();
test('phone invitation accepts exact verified Auth number with and without leading plus',()=>{
 assert.equal(sameInvitePhoneNumber('+5492216551930','5492216551930'),true);
 assert.equal(sameInvitePhoneNumber('+5492216551930','+5492216551930'),true);
 assert.equal(sameInvitePhoneNumber('5492216551930','+5492216551930'),true);
});
test('phone invitation rejects another number, truncated digits, and missing identity',()=>{
 assert.equal(sameInvitePhoneNumber('+5492216551930','5492216551931'),false);
 assert.equal(sameInvitePhoneNumber('+5492216551930','2216551930'),false);
 assert.equal(sameInvitePhoneNumber('+5492216551930',''),false);
 assert.equal(sameInvitePhoneNumber('','5492216551930'),false);
 assert.equal(sameInvitePhoneNumber('++5492216551930','5492216551930'),false);
});
test('resume and redeem use same full-number comparison',()=>{
 const enter=extract('async function patientEnter(){','let patientRescheduleState=null;');
 const resume=extract('async function resumeCloudSession(){','function showProfessionalPasswordRecovery(){');
 assert.match(enter,/code&&invitedPhone&&!sameInvitePhoneNumber\(invitedPhone,s\.phone\)/);
 assert.match(resume,/targetPhone&&!sameInvitePhoneNumber\(targetPhone,s\.phone\)/);
});

const phoneVerifiedSql=await readFile(new URL('./supabase/cithela_patient_verified_email_or_phone_20261029.sql',import.meta.url),'utf8');
test('all six patient self-service database routines accept confirmed email OR phone',()=>{
 const names=['patient_booking_catalog','patient_booking_slots','patient_booking_create',
   'patient_appointment_command','patient_reschedule_slots','patient_shared_note_update'];
 for(const name of names){
   const fnStart=phoneVerifiedSql.indexOf('CREATE OR REPLACE FUNCTION cithela_private.'+name+'(');
   assert.ok(fnStart>=0,'Missing '+name);
   const next=phoneVerifiedSql.indexOf('$function$;',fnStart);
   assert.ok(next>fnStart,'Missing closing function '+name);
   const def=phoneVerifiedSql.slice(fnStart,next);
   assert.match(def,/auth\.uid\(\)/);
   assert.match(def,/coalesce\(u\.email_confirmed_at,u\.phone_confirmed_at\)/);
   assert.match(def,/identity_not_verified/);
   assert.match(def,/cithela_patient_links/,'Tenant/person linkage must remain enforced: '+name);
   assert.doesNotMatch(def,/select u\.email_confirmed_at into v_verified/);
 }
 assert.equal((phoneVerifiedSql.match(/CREATE OR REPLACE FUNCTION cithela_private\./g)||[]).length,6);
 assert.match(script,/identity_not_verified:'Primero verificá tu WhatsApp o tu correo\.'/);
});

const readableDateFn=new Function(extract('function patientReadableDate(date){','function patientBookingDateShift(date,days){')+'\nreturn patientReadableDate;')();
test('patient appointment dates are readable in Spanish and safe for malformed values',()=>{
 assert.match(readableDateFn('2026-10-30'),/viernes,? 30 de octubre/i);
 assert.match(readableDateFn('2026-10-29'),/jueves,? 29 de octubre/i);
 assert.equal(readableDateFn('2026-02-31'),'2026-02-31');
 assert.equal(readableDateFn('not-a-date'),'not-a-date');
 assert.match(script,/escHtml\(patientReadableDate\(date.fecha\)\)/);
});
test('reservation confirmation does not assert pending when authoritative status may be confirmed',()=>{
 assert.match(script,/toast\('Turno registrado\. Revisá su estado actualizado en Mis turnos\.'/);
 assert.doesNotMatch(script,/toast\('Turno reservado; quedó pendiente de confirmación/);
});
