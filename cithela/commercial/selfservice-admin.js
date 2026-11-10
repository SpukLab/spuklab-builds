// Optional settings UI; unavailable endpoint leaves existing console operational.
window.loadCithelaSelfserviceSettings=async function(client){
 const host=document.getElementById('selfservice-controls');if(!host)return;
 const status=host.querySelector('[role=status]');
 const form=host.querySelector('form');
 const invoke=async(action,payload={})=>{const {data,error}=await client.functions.invoke('cithela-selfservice',{body:{action,payload}});if(error||data?.ok!==true){let code=data?.code;try{if(error?.context)code=(await error.context.json())?.code}catch{}throw Object.assign(Error('unavailable'),{code})}return data};
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
 const qa=host.querySelector('#selfservice-test');if(!qa)return;qa.hidden=false;if(window.location.hash==='#selfservice-test')qa.scrollIntoView({block:'start'});
 const qaForm=host.querySelector('#selfservice-test-form');const qaStatus=host.querySelector('#selfservice-test-status');const qaLink=host.querySelector('#selfservice-test-link');
 qaForm.onsubmit=async event=>{
  event.preventDefault();const button=qaForm.querySelector('button');button.disabled=true;qaLink.hidden=true;
  try{
   const email=host.querySelector('#selfservice-test-email').value.trim().toLowerCase();
   const out=await invoke('authorize_test',{email});
   qaStatus.textContent='Correo autorizado hasta '+new Date(out.expires_at).toLocaleString('es-AR')+'. Abrí el registro y usá exactamente ese correo. Las altas públicas siguen cerradas.';qaLink.hidden=false;
  }catch(e){const messages={capacity_reached:'Ya hay dos autorizaciones de prueba pendientes. Usá una existente o esperá su vencimiento.',workspace_exists:'Ese correo ya tiene un establecimiento. Usá otro correo que puedas verificar.',existing_invitation:'Ese correo ya tiene una invitación o autorización previa. Usá un correo de prueba distinto.',invalid_email:'Ingresá un correo válido.'};qaStatus.textContent=messages[e.code]||'No se pudo autorizar el correo. Volvé a comprobar tu sesión.'}
  finally{button.disabled=false}
 };
};
