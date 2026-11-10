// Administrative sessions never read or copy the professional session.
(function(global){
 'use strict';
 const STORAGE_KEY='cithela-platform-admin-auth-v1';
 let client;
 function createClient(url,key){
  if(!client)client=global.supabase.createClient(url,key,{auth:{
   storageKey:STORAGE_KEY,persistSession:true,autoRefreshToken:true,detectSessionInUrl:false
  }});
  global.CithelaAuthCaptcha?.wrap(client);
  return client;
 }
 async function requireSession(supa,gate){
  const {data,error}=await supa.auth.getSession();
  if(error)throw Error('No se pudo recuperar el acceso administrativo.');
  if(data?.session)return data.session;
  gate('Ingresá con la cuenta administradora. Este acceso es independiente de tu agenda.');
  const host=document.getElementById('gate');
  let form=document.getElementById('admin-login');
  if(form)form.remove();
  form=document.createElement('form');form.id='admin-login';
  form.innerHTML='<label for="admin-email">Correo administrativo</label><input id="admin-email" type="email" autocomplete="username" required><label for="admin-password">Contraseña</label><input id="admin-password" type="password" autocomplete="current-password" required><button type="submit" style="margin-top:16px">Ingresar a Administración</button><p role="status" aria-live="polite"></p>';
  host.append(form);
  return new Promise(resolve=>{
   form.addEventListener('submit',async event=>{
    event.preventDefault();const button=form.querySelector('button'),status=form.querySelector('p');
    button.disabled=true;status.textContent='Comprobando acceso…';
    try{
     const {data,error}=await supa.auth.signInWithPassword({email:form.querySelector('[type=email]').value.trim(),password:form.querySelector('[type=password]').value});
     form.querySelector('[type=password]').value='';
     if(error||!data?.session){status.textContent='No se pudo ingresar. Revisá el correo, la contraseña y su verificación.';return;}
     form.remove();resolve(data.session);
    }catch{status.textContent='No se pudo contactar el servicio. Intentá nuevamente.';}
    finally{button.disabled=false;}
   });
  });
 }
 function addLogout(supa){
  if(document.getElementById('admin-logout'))return;
  const button=document.createElement('button');button.type='button';button.id='admin-logout';
  button.textContent='Cerrar sesión administrativa';button.className='secondary';
  button.addEventListener('click',async()=>{
   button.disabled=true;
   const {error}=await supa.auth.signOut({scope:'local'});
   if(error){button.disabled=false;return;}
   global.location.reload();
  });
  document.querySelector('header nav')?.append(button);
 }
 global.CithelaAdminAuth={createClient,requireSession,addLogout};
})(window);
