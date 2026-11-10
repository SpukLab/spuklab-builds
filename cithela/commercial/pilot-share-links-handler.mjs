// CITHELA — reusable pilot links for WhatsApp, strictly feature-gated.
// No payment, no public trial or bearer token exposed in list endpoints.
const ORIGIN='https://spuklab.github.io';
const BASE='https://spuklab.github.io/spuklab-builds/cithela/alta-whatsapp.html#invitacion=';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX=/^[0-9a-f]{64}$/;
const HEADERS={
 'Access-Control-Allow-Origin':ORIGIN,
 'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info',
 'Access-Control-Allow-Methods':'POST,OPTIONS',
 'Cache-Control':'no-store','Vary':'Origin'
};
const respond=(status,code,extra={})=>
 Response.json({ok:status===200,code,...extra},{status,headers:HEADERS});
export async function handlePilotShareLinks(req,ctx){
 if(req?.method==='OPTIONS')return new Response(null,{status:204,headers:HEADERS});
 if(req?.method!=='POST')return respond(405,'method_not_allowed');
 if(req.headers.get('origin')!==ORIGIN)return respond(403,'origin_denied');
 if(ctx?.enabled!==true || !UUID.test(ctx.adminId||'')
    || typeof ctx.resolveUser!=='function' || typeof ctx.execute!=='function'
    || typeof ctx.generateToken!=='function' || typeof ctx.digestToken!=='function')
   return respond(503,'share_links_not_enabled');

 const bearer=/^Bearer\s+([^\s]+)$/i.exec(req.headers.get('authorization')||'')?.[1];
 if(!bearer)return respond(401,'unauthenticated');
 let actor;
 try{actor=await ctx.resolveUser(bearer)}catch{return respond(503,'auth_unavailable')}
 if(!actor||!UUID.test(actor.id||''))return respond(401,'unauthenticated');
 if(actor.emailConfirmed!==true)return respond(403,'email_unverified');

 if(Number(req.headers.get('content-length')||0)>1500)
   return respond(413,'request_too_large');
 let body;
 try{
  const raw=await req.text();
  if(raw.length>1500)return respond(413,'request_too_large');
  body=JSON.parse(raw);
 }catch{return respond(400,'invalid_json')}
 if(!body || typeof body!=='object'||Array.isArray(body)||
    Object.keys(body).sort().join(',')!=='action,payload' ||
    !body.payload||typeof body.payload!=='object'||Array.isArray(body.payload))
   return respond(400,'invalid_body');
 const {action,payload}=body;
 if(!['issue','list','revoke','redeem'].includes(action))
   return respond(400,'invalid_action');
 if(action!=='redeem' && actor.id.toLowerCase()!==ctx.adminId.toLowerCase())
   return respond(403,'not_admin');
 const keys=Object.keys(payload).sort().join(',');
 if(action==='issue'){
   if(keys!=='maxUses'||!Number.isInteger(payload.maxUses)||
     payload.maxUses<1||payload.maxUses>5)
     return respond(400,'invalid_quota');
 }else if(action==='list'){
   if(keys!=='')return respond(400,'unexpected_fields');
 }else if(action==='revoke'){
   if(keys!=='linkId'||!UUID.test(payload.linkId||''))
     return respond(400,'invalid_link');
 }else if(keys!=='token'||typeof payload.token!=='string'||
        !HEX.test(payload.token))return respond(400,'invalid_link');

 try{
   let command={};
   let token;
   if(action==='issue'){
      token=ctx.generateToken();
      if(typeof token!=='string'||!HEX.test(token))return respond(503,'secret_generation_failed');
      const hash=await ctx.digestToken(token);
      if(typeof hash!=='string'||!HEX.test(hash))return respond(503,'secret_generation_failed');
      command={token_hash:hash,max_uses:payload.maxUses};
   }else if(action==='redeem'){
      const hash=await ctx.digestToken(payload.token);
      if(typeof hash!=='string'||!HEX.test(hash))return respond(503,'secret_generation_failed');
      command={token_hash:hash};
   }else if(action==='revoke')command={link_id:payload.linkId};
   const out=await ctx.execute(actor.id,action,command);
   if(!out||typeof out.ok!=='boolean'||typeof out.code!=='string')
     return respond(503,'invalid_server_response');
   if(out.ok!==true){
     return respond(['daily_limit','link_exhausted'].includes(out.code)?429:
        ['email_unverified','already_authorized','trial_already_used'].includes(out.code)?403:
        ['link_unavailable','link_not_found'].includes(out.code)?404:400,out.code);
   }
   if(action==='issue'){
     if(out.code!=='link_created'||!UUID.test(out.link_id||'')
       ||out.max_uses!==payload.maxUses||Number.isNaN(Date.parse(out.expires_at||'')))
       return respond(503,'invalid_server_response');
     return respond(200,out.code,{link_id:out.link_id,max_uses:out.max_uses,
       expires_at:out.expires_at,share_url:BASE+token});
   }
   if(action==='list'){
     if(out.code!=='links_listed'||!Array.isArray(out.links))
       return respond(503,'invalid_server_response');
     return respond(200,out.code,{links:out.links});
   }
   if(action==='redeem'&&!['grant_ready','workspace_exists'].includes(out.code))
     return respond(503,'invalid_server_response');
   if(action==='revoke'&&out.code!=='link_revoked')
     return respond(503,'invalid_server_response');
   return respond(200,out.code);
 }catch{return respond(503,'server_unavailable')}
}
