(function(){
 'use strict';
 const $=id=>document.getElementById(id);
 const BASE='https://spuklab.github.io/spuklab-builds/cithela/';
 const API='https://mcqknmqhtmihegmifuka.supabase.co';
 const KEY='sb_publishable__QKhInQSZjLyncQsQoRJzw_dQuwf5jc';
 const client=window.supabase?.createClient(API,KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
 if(!client){$('availability').textContent='No se pudo cargar el acceso seguro. Volvé a cargar la página.';return}
 window.CithelaAuthCaptcha.wrap(client);
 let available=null,session=null,resumeCode=null,busy=false;
 const testMode=new URLSearchParams(window.location.search).get('prueba')==='1';
 let testRegistration=false;
 const descriptions={capacity_reached:'Por ahora se completó el cupo de pruebas. Podés ingresar si ya tenés cuenta.',admissions_closed:'Las altas automáticas están cerradas por el momento.',captcha_rejected:'La comprobación de seguridad venció o no pudo verificarse. Intentá nuevamente.',captcha_unavailable:'No se pudo verificar la seguridad. Intentá nuevamente.',email_unverified:'Confirmá tu correo antes de continuar.',trial_already_used:'Esta cuenta ya utilizó una prueba. Ingresá a tu agenda para consultar la continuidad.',existing_invitation:'Ya tenés una invitación. Abrí el enlace recibido para continuar.',terms_required:'Las condiciones se actualizaron. Volvé a comprobar la disponibilidad y revisalas.',admission_unavailable:'No se pudo autorizar la prueba. Intentá más adelante.',server_unavailable:'El servicio no respondió. Intentá nuevamente.'};
 function message(text){$('status').textContent=text}
 function render(){
  const verified=!!session?.user?.email_confirmed_at;
  $('connected').hidden=!verified;$('register').hidden=verified;
  $('identity').textContent=verified?'Correo verificado: '+session.user.email:'';
  $('create').disabled=busy||(!available&&!testRegistration);
  $('login').disabled=busy;
  $('activate').disabled=busy||!available||!!resumeCode;
  $('activate').hidden=!!resumeCode;$('continue').hidden=!resumeCode;
  $('switch').disabled=busy;$('continue').disabled=busy;
 }
 async function invoke(action,payload={}){
  const {data,error}=await client.functions.invoke('cithela-selfservice',{body:{action,payload}});
  if(error){
   let code;try{code=(await error.context?.json())?.code}catch{}
   throw Object.assign(Error(descriptions[code]||'No se pudo conectar. Intentá nuevamente.'),{code});
  }
  if(data?.ok!==true)throw Object.assign(Error(descriptions[data?.code]||'No se pudo completar la solicitud.'),{code:data?.code});
  return data;
 }
 async function resume(){
  resumeCode=null;
  if(session?.user?.email_confirmed_at){
   try{const out=await invoke('resume');if(['grant_ready','workspace_exists'].includes(out.code))resumeCode=out.code}catch{}
  }
  render();
 }
 async function check(){
  available=null;$('availability').textContent='Comprobando disponibilidad…';render();
  try{
   const res=await fetch(API+'/functions/v1/cithela-selfservice',{method:'POST',headers:{apikey:KEY,'content-type':'application/json'},body:JSON.stringify({action:'status',payload:{}}),signal:AbortSignal.timeout(8000)});
   const data=await res.json();
   if(res.ok&&data.ok&&data.code==='available'&&typeof data.terms_version==='string'&&typeof data.sitekey==='string'&&data.sitekey){available=data;$('availability').textContent='Hay cupo disponible. Se comprobará nuevamente al activar la prueba.'}
   else $('availability').textContent=descriptions[data.code]||'Las altas automáticas no están disponibles. Podés consultar por WhatsApp.';
  }catch{$('availability').textContent='No pudimos comprobar disponibilidad. Podés reintentar o consultar por WhatsApp.'}
  if(!available&&session?.user?.email_confirmed_at){
   try{const data=await invoke('test_status');if(data.code==='available'){available=data;$('availability').textContent='Prueba controlada autorizada para tu correo. Las altas públicas siguen cerradas.'}}catch{}
  }
  if(testMode&&!session){
   const cfg=await window.CithelaAuthCaptcha.config();
   testRegistration=cfg.required===true&&!!cfg.sitekey;
   if(testRegistration)$('availability').textContent='Registro de prueba: usá solamente el correo autorizado en Administración. Crear una cuenta no concede acceso a una agenda.';
  }
  await resume();render();
 }
 $('register').addEventListener('submit',async event=>{
  event.preventDefault();if(busy||(!available&&!testRegistration))return;
  const email=$('email').value.trim().toLowerCase(),password=$('password').value;
  if(password.length<8||password!==$('confirm').value)return message('Las contraseñas deben coincidir y tener al menos 8 caracteres.');
  busy=true;render();message('Preparando el correo de confirmación…');
  try{
   const {data,error}=await client.auth.signUp({email,password,options:{emailRedirectTo:BASE+'alta-autoservicio.html'}});
   if(error)throw error;
   session=data?.session||null;
   message(session?'Revisando tu cuenta…':'Revisá tu correo y abrí el enlace de confirmación. Después volvé aquí e ingresá si hace falta. No solicites varios correos seguidos.');
   $('password').value='';$('confirm').value='';await resume();
  }catch(e){message(e.code==='over_email_send_rate_limit'?'Se alcanzó el límite de correos. Esperá antes de volver a intentar.':e.message||'No se pudo crear la cuenta.')}
  finally{busy=false;render()}
 });
 $('login').addEventListener('click',async()=>{
  if(busy)return;busy=true;render();message('Ingresando…');
  try{
   const {data,error}=await client.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value});
   if(error)throw error;session=data.session;await check();
   message(resumeCode?'Tu acceso está disponible. Podés continuar con tu agenda.':session?.user?.email_confirmed_at?'Revisá las condiciones para comenzar la prueba.':'Confirmá tu correo antes de continuar.');
  }catch{message('No se pudo ingresar. Comprobá correo, contraseña y verificación.')}
  finally{busy=false;$('password').value='';render()}
 });
 $('activate').addEventListener('click',async()=>{
  if(busy||!available||!session?.user?.email_confirmed_at)return;
  if(!$('accept-terms').checked)return message('Revisá y aceptá las condiciones de la prueba.');
  busy=true;render();message('Comprobando tu solicitud…');
  try{
   const captchaToken=await window.CithelaAuthCaptcha.token(available.sitekey,'cithela-admission');
   const data=await invoke('admit',{terms_version:available.terms_version,captchaToken});
   if(!['grant_ready','workspace_exists'].includes(data.code))throw Error('Respuesta no reconocida.');
   window.location.assign(BASE+(data.code==='grant_ready'?'?pilotTenant=1':''));
  }catch(e){message(e.message||'No se pudo activar la prueba.');if(['capacity_reached','admissions_closed','terms_required'].includes(e.code))await check()}
  finally{busy=false;render()}
 });
 $('continue').addEventListener('click',()=>{if(resumeCode)window.location.assign(BASE+(resumeCode==='grant_ready'?'?pilotTenant=1':''))});
 $('switch').addEventListener('click',async()=>{
  const {error}=await client.auth.signOut({scope:'local'});if(error)return message('No se pudo cerrar la sesión. Intentá nuevamente.');
  session=null;resumeCode=null;$('password').value='';$('confirm').value='';await check();message('Sesión cerrada. Ingresá con tu cuenta.');
 });
 $('retry').addEventListener('click',()=>{if(!busy)check()});
 client.auth.onAuthStateChange((_event,newSession)=>{session=newSession;render();setTimeout(resume,0)});
 client.auth.getSession().then(({data,error})=>{if(!error)session=data?.session||null;check()});
 render();
})();
