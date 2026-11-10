// Administración SpukLab: enlaces de piloto compartibles por WhatsApp.
// Runs only on the restricted invitation page. Existing per-email invites remain.
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const msgs={
 share_links_not_enabled:'Los enlaces para WhatsApp todavía no están habilitados. Las invitaciones por correo siguen disponibles.',
 daily_limit:'Se alcanzó el máximo diario de enlaces. Volvé a intentarlo mañana.',
 not_admin:'Solo SpukLab puede generar o revocar enlaces.',
 email_unverified:'Verificá primero tu correo de administrador.',
 unauthenticated:'Tu sesión venció. Ingresá a CITHELA y volvé a esta página.',
 origin_denied:'Abrí esta página desde la dirección de CITHELA.'
};
let busy=false,shareUrl='';
const status=msg=>{$('share-status').textContent=msg};
function client(){return window.cithelaInvitationClient||null}
async function call(action,payload={}){
 const c=client();
 if(!c)throw Error('Primero ingresá como administrador en CITHELA.');
 const {data,error}=await c.functions.invoke('cithela-pilot-share-links',{
  body:{action,payload}
 });
 if(error)throw Error('No se pudo contactar el servicio de enlaces.');
 if(!data?.ok)throw Error(msgs[data?.code]||
    'No se pudo completar la operación ('+(data?.code||'desconocido')+').');
 return data;
}
async function refresh(){
 if(busy)return;
 busy=true;
 $('refresh-share').disabled=true;
 try{
  const data=await call('list',{});
  const rows=(data.links||[]).map(link=>{
   const tr=document.createElement('tr');
   const a=document.createElement('td');a.textContent=new Date(link.issued_at).toLocaleDateString('es-AR');
   const b=document.createElement('td');b.textContent=String(link.used)+' / '+String(link.max_uses);
   const c=document.createElement('td');
   c.textContent=({active:'Disponible',exhausted:'Sin cupos',expired:'Vencido',revoked:'Revocado'})[link.status]||'Desconocido';
   if(link.status==='active'){
    const revoke=document.createElement('button');
    revoke.type='button';revoke.className='secondary';
    revoke.textContent='Revocar';revoke.style.marginLeft='8px';
    revoke.addEventListener('click',()=>revokeLink(link.id));
    c.append(' ',revoke);
   }
   tr.append(a,b,c);return tr;
  });
  $('share-items').replaceChildren(...rows);
  if(!shareUrl)status('Generá un enlace para compartir con los profesionales seleccionados.');
 }catch(e){status(e.message)}
 finally{busy=false;$('refresh-share').disabled=false}
}
async function revokeLink(linkId){
 if(busy||!confirm('¿Revocar este enlace? Las agendas ya creadas no se modifican.'))return;
 busy=true;
 try{
  await call('revoke',{linkId});
  shareUrl='';$('share-url').value='';$('share-result').hidden=true;
  status('Enlace revocado. Las agendas existentes siguen funcionando.');
 }catch(e){status(e.message)}finally{busy=false}
 await refresh();
}
async function issue(){
 if(busy)return;
 busy=true;
 $('create-share').disabled=true;$('share-result').hidden=true;shareUrl='';
 status('Generando enlace seguro...');
 try{
  const maxUses=Number($('share-quota').value);
  const out=await call('issue',{maxUses});
  const prefix='https://spuklab.github.io/spuklab-builds/cithela/alta-whatsapp.html#invitacion=';
  if(typeof out.share_url!=='string'||!out.share_url.startsWith(prefix)||
    !/^[0-9a-f]{64}$/.test(out.share_url.slice(prefix.length)))
    throw Error('El servidor no devolvió un enlace válido.');
  shareUrl=out.share_url;
  $('share-url').value=shareUrl;$('share-result').hidden=false;
  status('Enlace listo. Vence el '+new Date(out.expires_at).toLocaleDateString('es-AR')+
    '. Solo será válido para '+out.max_uses+' profesionales.');
 }catch(e){status(e.message)}
 finally{busy=false;$('create-share').disabled=false}
 await refresh();
}
$('create-share').addEventListener('click',issue);
$('refresh-share').addEventListener('click',refresh);
$('copy-share').addEventListener('click',async()=>{
 if(!shareUrl)return;
 try{await navigator.clipboard.writeText(shareUrl);status('Enlace copiado.')}
 catch{$('share-url').select();status('Copiá manualmente el enlace seleccionado.')}
});
$('send-share').addEventListener('click',()=>{
 if(!shareUrl)return;
 const message='Te invito a probar CITHELA, una agenda de turnos para profesionales.\n\n'+
  'Abrí el enlace, registrate con tu correo y confirmalo. Configurá tu agenda y probala 7 días gratis, sin tarjeta ni cobro automático.\n\n'+
  shareUrl+'\n\nEste enlace vence en 7 días y tiene cupos limitados.';
 window.location.href='https://wa.me/?text='+encodeURIComponent(message);
});
refresh();
})();