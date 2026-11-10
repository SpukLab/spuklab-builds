// Optional settings UI; unavailable endpoint leaves existing console operational.
window.loadCithelaSelfserviceSettings=async function(client){
 const host=document.getElementById('selfservice-controls');if(!host)return;
 const status=host.querySelector('[role=status]');
 const form=host.querySelector('form');
 const invoke=async(action,payload={})=>{const {data,error}=await client.functions.invoke('cithela-selfservice',{body:{action,payload}});if(error||data?.ok!==true)throw Error('unavailable');return data};
 function show(data){const settings=data.settings;form.hidden=false;for(const key of ['daily_limit','active_limit','invitation_hours'])form.elements[key].value=settings[key];form.elements.enabled.checked=settings.enabled;}
 try{const data=await invoke('read');show(data);status.textContent=data.runtime?.captcha_configured?'Cupos disponibles. La apertura requiere verificación completa y habilitación de servidor.':'Cupos instalados. Falta configurar Turnstile antes de abrir el alta automática.'}catch{status.textContent='Cupos autoservicio en preparación. Las invitaciones actuales siguen disponibles.';return;}
 form.onsubmit=async event=>{
  event.preventDefault();const button=form.querySelector('button');button.disabled=true;
  try{
   const payload={enabled:form.elements.enabled.checked};
   for(const key of ['daily_limit','active_limit','invitation_hours'])payload[key]=Number(form.elements[key].value);
   show(await invoke('configure',payload));status.textContent='Cupos guardados. Esto no activa cobros ni elimina datos.';
  }catch{status.textContent='No se pudieron guardar los cupos. Volvé a comprobar el acceso.'}finally{button.disabled=false}
 };
};
