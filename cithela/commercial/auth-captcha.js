// Shared Auth protection. Tokens are fresh per operation; no sessions or credentials are stored here.
(function(root,factory){
 const api=factory(root);
 if(typeof module==='object'&&module.exports)module.exports=api;
 else root.CithelaAuthCaptcha=api;
})(typeof window==='object'?window:globalThis,function(root){
 'use strict';
 const ENDPOINT='https://mcqknmqhtmihegmifuka.supabase.co/functions/v1/cithela-selfservice';
 const KEY='sb_publishable__QKhInQSZjLyncQsQoRJzw_dQuwf5jc';
 const wrapped=new WeakSet();let cached=null,cacheAt=0,loading=null,pending=null;
 async function config(force=false){
  if(!force&&cached&&Date.now()-cacheAt<60000)return cached;
  try{
   const res=await root.fetch(ENDPOINT,{method:'POST',headers:{apikey:KEY,'content-type':'application/json'},body:JSON.stringify({action:'auth_config',payload:{}}),signal:AbortSignal.timeout(6000)});
   const data=await res.json();
   if(!res.ok||data?.ok!==true||typeof data.required!=='boolean')throw Error('config_unavailable');
   // A configured public sitekey is enough to prepare a CAPTCHA, even if a
   // separate feature flag has not been synchronized with Supabase Auth.
   const sitekey=typeof data.sitekey==='string'&&data.sitekey.trim()?data.sitekey.trim():null;
   cached={required:data.required===true||!!sitekey,sitekey};cacheAt=Date.now();return cached;
  }catch{
   // Keep current sessions working. Auth remains authoritative; a missing
   // token is handled below and never confused with invalid credentials.
   return cached||{required:false,sitekey:null};
  }
 }
 function missingCaptcha(error){
  return !!error&&(String(error.code||'').toLowerCase()==='captcha_failed'&&
   /no captcha_token found|captcha.?token/i.test(String(error.message||''))||
   /captcha protection.*no captcha_token found/i.test(String(error.message||'')));
 }
 function captchaError(message){
  return {data:null,error:{name:'CithelaCaptchaError',code:'captcha_required',
   message:message||'La verificación de seguridad no está disponible. Contactá al administrador de CITHELA; no es un problema de tu contraseña.'}};
 }
 function load(){
  if(root.turnstile)return Promise.resolve();
  if(loading)return loading;
  loading=new Promise((resolve,reject)=>{
   const existing=root.document.querySelector('script[data-cithela-turnstile]');
   const script=existing||root.document.createElement('script');
   const timer=setTimeout(()=>reject(Error('No se pudo cargar la comprobación de seguridad.')),15000);
   script.addEventListener('load',()=>{clearTimeout(timer);root.turnstile?resolve():reject(Error('Comprobación de seguridad no disponible.'))},{once:true});
   script.addEventListener('error',()=>{clearTimeout(timer);reject(Error('No se pudo cargar la comprobación de seguridad.'))},{once:true});
   if(!existing){script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';script.async=true;script.defer=true;script.dataset.cithelaTurnstile='true';root.document.head.append(script)}
  }).catch(e=>{loading=null;root.document.querySelector('script[data-cithela-turnstile]')?.remove();throw e});
  return loading;
 }
 async function token(sitekey,action='cithela-auth'){
  if(typeof sitekey!=='string'||!sitekey)throw Error('Falta configurar la comprobación de seguridad.');
  if(pending)throw Error('Completá primero la comprobación de seguridad que está abierta.');
  pending=true;
  try{
   await load();
   return await new Promise((resolve,reject)=>{
    const overlay=root.document.createElement('div');overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-labelledby','cithela-security-title');
    overlay.style.cssText='position:fixed;inset:0;z-index:2147483647;background:#102c36b3;display:flex;align-items:center;justify-content:center;padding:16px;';
    const panel=root.document.createElement('div');panel.style.cssText='width:100%;max-width:370px;background:#fffefa;color:#213b36;border-radius:16px;padding:22px;font:16px/1.5 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;';
    const title=root.document.createElement('h2');title.id='cithela-security-title';title.textContent='Comprobación de seguridad';title.style.cssText='font-size:20px;margin:0 0 14px';
    const mount=root.document.createElement('div');const status=root.document.createElement('p');status.setAttribute('role','status');status.textContent='Completá la verificación para continuar.';
    const cancel=root.document.createElement('button');cancel.type='button';cancel.textContent='Cancelar';cancel.style.cssText='min-height:44px;font:inherit;padding:8px 16px;';
    panel.append(title,mount,status,cancel);overlay.append(panel);root.document.body.append(overlay);
    const focus=root.document.activeElement;let id=null,finished=false;
    const finish=(error,value)=>{if(finished)return;finished=true;clearTimeout(timer);if(id!==null)root.turnstile.remove(id);overlay.remove();focus?.focus?.();error?reject(error):resolve(value)};
    const timer=setTimeout(()=>finish(Error('La comprobación venció. Intentá nuevamente.')),180000);
    cancel.addEventListener('click',()=>finish(Error('Comprobación cancelada.')));
    overlay.addEventListener('keydown',event=>{if(event.key==='Escape')finish(Error('Comprobación cancelada.'))});
    try{id=root.turnstile.render(mount,{sitekey,action,theme:'light',size:'flexible',callback:value=>finish(null,value),'error-callback':()=>finish(Error('No se pudo verificar la seguridad. Intentá nuevamente.')),'expired-callback':()=>finish(Error('La comprobación venció. Intentá nuevamente.'))});cancel.focus()}catch{finish(Error('No se pudo mostrar la comprobación de seguridad.'))}
   });
  }finally{pending=null}
 }
 function wrap(client,dependencies={}){
  if(!client?.auth||wrapped.has(client))return client;
  wrapped.add(client);
  const getConfig=dependencies.config||config,getToken=dependencies.token||token;
  for(const method of ['signUp','signInWithPassword','signInWithOtp','resend','resetPasswordForEmail']){
   if(typeof client.auth[method]!=='function')continue;
   const original=client.auth[method].bind(client.auth);
   client.auth[method]=async(...args)=>{
    const cfg=await getConfig();
    const runWithCaptcha=async sitekey=>{
     if(!sitekey)return captchaError();
     try{
      const value=await getToken(sitekey,'cithela-auth');
      if(typeof value!=='string'||!value)throw Error('Comprobación de seguridad incompleta.');
      if(method==='resetPasswordForEmail')return original(args[0],{...args[1],captchaToken:value});
      const first=args[0]||{};
      return original({...first,options:{...first.options,captchaToken:value}},...args.slice(1));
     }catch(e){return captchaError(e.message||'Repetí la comprobación de seguridad.')}
    };
    if(cfg.required)return runWithCaptcha(cfg.sitekey);
    const result=await original(...args);
    if(!missingCaptcha(result?.error))return result;
    // The application and Auth settings can differ. Retry exactly once with a
    // fresh token; never retry invalid credentials or other Auth failures.
    const fresh=await getConfig(true);
    return runWithCaptcha(fresh.sitekey);
   };
  }
  return client;
 }
 return {config,token,wrap};
});
