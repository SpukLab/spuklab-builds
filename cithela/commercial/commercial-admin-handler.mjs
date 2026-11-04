// Commercial console server gate. Does not process a checkout or delete data.
// All actions are authorized by a verified server-side Supabase JWT and a single
// dedicated platform admin UUID secret. The browser cannot choose its role.
const ORIGIN='https://spuklab.github.io';
const HEADERS={
 'Access-Control-Allow-Origin':ORIGIN,
 'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info',
 'Access-Control-Allow-Methods':'POST, OPTIONS',
 'Cache-Control':'no-store','Vary':'Origin'
};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS=new Set(['read','create_price','choose_price',
  'grant_free','revoke_free','set_retention']);
const send=(status,code,extra={})=>Response.json({ok:status===200,code,...extra},
  {status,headers:HEADERS});

export async function handleCithelaCommercialAdmin(request,settings) {
 if(request?.method==='OPTIONS')return new Response(null,{status:204,headers:HEADERS});
 if(request?.method!=='POST')return send(405,'method_not_allowed');
 if(request.headers.get('origin')!==ORIGIN)return send(403,'origin_denied');
 if(settings?.enabled!==true || !UUID.test(settings?.adminId||'') ||
    typeof settings?.resolveUser!=='function' ||
    typeof settings?.execute!=='function')
   return send(503,'console_not_enabled');

 const bearer=/^Bearer\s+([^\s]+)$/i.exec(request.headers.get('authorization')||'')?.[1];
 if(!bearer)return send(401,'unauthenticated');
 let user;
 try{user=await settings.resolveUser(bearer);}catch{return send(503,'auth_unavailable');}
 if(!user || !UUID.test(user.id||''))return send(401,'unauthenticated');
 if(user.emailConfirmed!==true || user.id.toLowerCase()!==settings.adminId.toLowerCase())
   return send(403,'not_platform_admin');

 const length=Number(request.headers.get('content-length')||0);
 if(length>3600)return send(413,'request_too_large');
 let input;
 try{
  const body=await request.text();
  if(body.length>3600)return send(413,'request_too_large');
  input=JSON.parse(body);
 }catch{return send(400,'invalid_body');}
 if(!input || typeof input!=='object' || Array.isArray(input) ||
    Object.keys(input).sort().join(',')!=='action,payload' ||
    !ACTIONS.has(input.action) ||
    !input.payload || typeof input.payload!=='object' || Array.isArray(input.payload))
   return send(400,'invalid_action');
 // Fail closed on unexpected fields. Every action has a tiny schema; no owner,
 // provider merchant, amount for charge, or production flags are client-controlled.
 const allowed={
  read:[],
  create_price:['label','amount_minor'],
  choose_price:['price_id'],
  grant_free:['tenant_id','reason','expires_at'],
  revoke_free:['tenant_id'],
  set_retention:['review_days','purge_review_days']
 };
 if(Object.keys(input.payload).some(k=>!allowed[input.action].includes(k)))
    return send(400,'unexpected_field');
 try{
   const response=await settings.execute(user.id,input.action,input.payload);
   if(!response || typeof response.code!=='string' || typeof response.ok!=='boolean')
     return send(503,'invalid_server_response');
   // Return only the server's own constrained command result. Values in
   // business names are never interpreted as HTML by the client.
   return Response.json(response,{status:response.ok?200:400,headers:HEADERS});
 }catch{return send(503,'server_unavailable');}
}
