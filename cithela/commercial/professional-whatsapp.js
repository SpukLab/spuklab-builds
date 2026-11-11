(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.CithelaProfessionalWhatsApp=api})(typeof window==='object'?window:globalThis,function(){
 'use strict';
 function phone(value){const p=String(value||'').trim().replace(/[\s()-]/g,'');if(!/^\+[1-9]\d{7,14}$/.test(p))throw Error('Ingresá el número internacional con + y código de país, sin 0 ni 15.');return p}
 function create(client,{now=()=>Date.now()}={}){
  let pending=null,lastSent=null,busy=false;
  async function account(){
   const {data,error}=await client.auth.getUser();if(error||!data?.user?.id)throw Error('Ingresá primero con tu cuenta profesional.');
   const user=data.user;
   const out=await client.from('cithela_tenant_memberships').select('tenant_id,role').eq('user_id',user.id);
   if(out.error||!out.data?.some(m=>['owner','admin','operator','viewer'].includes(m.role)))throw Error('Esta cuenta no tiene acceso profesional.');
   return user;
  }
  async function request(value,mode){
   if(busy)throw Error('Esperá a que termine la solicitud.');
   if(pending)throw Error('Ingresá el código pendiente o elegí otro número.');
   if(lastSent!==null&&now()-lastSent<60000)throw Error('Esperá un minuto antes de pedir otro código.');
   const target=phone(value);if(!['link','login'].includes(mode))throw Error('Operación inválida.');
   busy=true;
   try{
    let expectedId=null;
    if(mode==='link'){
     const user=await account();expectedId=user.id;
     if(user.phone_confirmed_at&&user.phone)throw Error('Ya hay un WhatsApp verificado en esta cuenta.');
     const {error}=await client.auth.updateUser({phone:target});if(error)throw error;
    }else{
     const {data,error}=await client.auth.getSession();if(error)throw error;
     if(data?.session)throw Error('Ya hay una sesión abierta. Volvé a tu agenda o cerrá esa sesión primero.');
     // Never create another identity for an existing professional's phone.
     const {error:sendError}=await client.auth.signInWithOtp({phone:target,options:{channel:'sms',shouldCreateUser:false}});if(sendError)throw sendError;
    }
    lastSent=now();pending={target,mode,expectedId};return {mode};
   }finally{busy=false}
  }
  async function verify(value){
   if(busy||!pending)throw Error('Solicitá primero el código.');
   const token=String(value||'').trim();if(!/^\d{6}$/.test(token))throw Error('Ingresá los seis números del código.');
   busy=true;const current={...pending};
   try{
    if(current.mode==='link'&&(await account()).id!==current.expectedId)throw Error('La sesión cambió. Volvé a empezar.');
    const {error}=await client.auth.verifyOtp({phone:current.target,token,type:current.mode==='link'?'phone_change':'sms'});if(error)throw error;
    const user=await account();
    if(!user.phone_confirmed_at||String(user.phone||'').replace(/^\+/,'')!==current.target.slice(1)||(current.expectedId&&user.id!==current.expectedId))throw Error('No se pudo comprobar la vinculación del número.');
    pending=null;return {ok:true};
   }catch(error){
    if(current.mode==='login')await client.auth.signOut({scope:'local'});
    throw error;
   }finally{busy=false}
  }
  function reset(){if(!busy)pending=null}
  return {account,request,verify,reset};
 }
 return {create,phone};
});
