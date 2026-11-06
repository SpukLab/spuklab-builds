// CITHELA / professional pilot invitation gate.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const origin='https://spuklab.github.io';
const headers={'Access-Control-Allow-Origin':origin,
 'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info',
 'Access-Control-Allow-Methods':'POST, OPTIONS','Cache-Control':'no-store','Vary':'Origin'};
const result=(code,status=400,more={})=>Response.json({ok:status===200,code,...more},{status,headers});
export async function handlePilotInvitations(req,ctx){
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return result('method_not_allowed',405);
 if(req.headers.get('origin')!==origin)return result('origin_denied',403);
 if(!ctx.enabled || !UUID.test(ctx.adminId||''))return result('not_enabled',503);
 const match=/^Bearer\\s+([^\\s]+)$/i.exec(req.headers.get('authorization')||'');
 if(!match)return result('unauthenticated',401);
 const user=await ctx.resolveUser(match[1]);
 if(!user||!UUID.test(user.id))return result('unauthenticated',401);
 if(!user.emailConfirmed)return result('email_unverified',403);
 let body;try{const raw=await req.text();if(raw.length>1024)return result('too_large',413);body=JSON.parse(raw)}
 catch{return result('invalid_json')}
 if(!body||typeof body!=='object'||Array.isArray(body)||
   Object.keys(body).sort().join(',')!=='action,payload'||
   !body.payload||typeof body.payload!=='object'||Array.isArray(body.payload))
   return result('invalid_body');
 const action=body.action;
 if(!['issue','revoke','list','redeem'].includes(action))return result('invalid_action');
 if(action!=='redeem'&&user.id.toLowerCase()!==ctx.adminId.toLowerCase())
   return result('not_admin',403);
 const keys=Object.keys(body.payload);
 if(action==='issue'||action==='revoke'){
  if(keys.length!==1||keys[0]!=='email'||typeof body.payload.email!=='string')
    return result('invalid_email');
 }else if(keys.length!==0)return result('unexpected_fields');
 const email=typeof body.payload.email==='string'?body.payload.email.trim().toLowerCase():null;
 if(email&&(email.length>254||!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)))
   return result('invalid_email');
 try{
  const out=await ctx.execute(user.id,action,email);
  if(typeof out?.ok!=='boolean'||typeof out?.code!=='string')return result('server_unavailable',503);
  return Response.json(out,{status:out.ok?200:400,headers});
 }catch{return result('server_unavailable',503)}
}
