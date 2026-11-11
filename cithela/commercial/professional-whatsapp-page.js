(async function(){
 'use strict';const $=id=>document.getElementById(id);let mode='login',busy=false;
 const message=text=>{$('status').textContent=text};
 try{
  const client=window.supabase.createClient('https://mcqknmqhtmihegmifuka.supabase.co','sb_publishable__QKhInQSZjLyncQsQoRJzw_dQuwf5jc',{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
  window.CithelaAuthCaptcha.wrap(client);const access=window.CithelaProfessionalWhatsApp.create(client);
  const {data,error}=await client.auth.getSession();if(error)throw error;
  if(data.session){
   const user=await access.account();
   if(user.phone&&user.phone_confirmed_at){$('session-note').textContent='Tu cuenta ya tiene un WhatsApp verificado. Podés volver a tu agenda.';return}
   mode='link';$('link-note').hidden=false;$('session-note').textContent='Vinculá WhatsApp a tu cuenta profesional actual.';
  }else $('session-note').textContent='Ingresá con el WhatsApp previamente vinculado a tu cuenta.';
  $('send').disabled=false;
  $('phone-form').addEventListener('submit',async event=>{
   event.preventDefault();if(busy)return;busy=true;$('send').disabled=true;message('Solicitando código…');
   try{await access.request($('phone').value,mode);$('phone-form').hidden=true;$('code-form').hidden=false;message('Solicitud aceptada. Revisá WhatsApp; el código tiene vencimiento.');$('code').focus()}
   catch(e){message(e.code==='over_sms_send_rate_limit'?'Esperá antes de pedir otro código.':e.message||'No se pudo solicitar el código.')}
   finally{busy=false;$('send').disabled=false}
  });
  $('code-form').addEventListener('submit',async event=>{
   event.preventDefault();if(busy)return;busy=true;$('verify').disabled=true;message('Comprobando código…');
   try{await access.verify($('code').value);$('code-form').hidden=true;$('phone-form').hidden=true;message(mode==='link'?'WhatsApp vinculado a tu cuenta. Conservaste la misma agenda.':'Acceso verificado. Podés abrir tu agenda.');$('agenda').textContent='Abrir mi agenda'}
   catch(e){message(e.message||'No se pudo verificar el código.')}
   finally{busy=false;$('verify').disabled=false;$('code').value=''}
  });
  $('reset').addEventListener('click',()=>{if(busy)return;access.reset();$('code').value='';$('code-form').hidden=true;$('phone-form').hidden=false;message('Si acabás de pedir un código, esperá un minuto antes de reenviar.')});
 }catch{message('No se pudo habilitar este acceso. Volvé a tu agenda e ingresá con tu cuenta profesional.');$('session-note').textContent='Acceso no disponible.'}
})();
