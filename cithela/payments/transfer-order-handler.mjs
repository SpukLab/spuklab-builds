// CITHELA — authenticated pending transfer request. NO payment processing.
// Public launch is blocked until both a signed offer and an Edge opt-in flag.
// The merchant alias/holder are server settings; NEVER customer-provided.
const ORIGIN='https://spuklab.github.io';
const H={
  'Access-Control-Allow-Origin':ORIGIN,
  'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info',
  'Access-Control-Allow-Methods':'POST,OPTIONS',
  'Cache-Control':'no-store','Vary':'Origin'
};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const send=(status,code,additional={})=>Response.json(
  {ok:status===200,code,...additional},{status,headers:H}
);

export async function handleTransferOrder(req,ctx){
  if(req?.method==='OPTIONS')return new Response(null,{status:204,headers:H});
  if(req?.method!=='POST')return send(405,'method_not_allowed');
  if(req.headers.get('origin')!==ORIGIN)return send(403,'origin_denied');
  if(ctx?.enabled!==true
      || typeof ctx.resolveUser!=='function'
      || typeof ctx.prepareOrder!=='function'
      || typeof ctx.alias!=='string' || !/^[a-z0-9_.-]{6,40}$/.test(ctx.alias)
      || typeof ctx.holder!=='string' || ctx.holder.trim().length<4)
    return send(503,'transfer_not_enabled');

  const bearer=/^Bearer\s+([^\s]+)$/i.exec(req.headers.get('authorization')||'')?.[1];
  if(!bearer)return send(401,'unauthenticated');

  if(Number(req.headers.get('content-length')||0)>2048)return send(413,'too_large');
  let body;
  try{
    const text=await req.text();
    if(text.length>2048)return send(413,'too_large');
    body=JSON.parse(text);
  }catch{return send(400,'invalid_json');}
  if(!body||typeof body!=='object'||Array.isArray(body)
      ||Object.keys(body).sort().join(',')!=='consent,tenantId,termsVersion'
      ||!UUID.test(body.tenantId||'')
      ||body.consent!==true
      ||body.termsVersion!=='cithela-billing-20261110')
    return send(400,'invalid_request');

  let user;
  try{user=await ctx.resolveUser(bearer);}catch{return send(503,'auth_unavailable');}
  if(!user||!UUID.test(user.id||''))return send(401,'unauthenticated');
  if(user.emailConfirmed!==true)return send(403,'email_unverified');

  try{
    const result=await ctx.prepareOrder({
      actorId:user.id,tenantId:body.tenantId,
      consent:true,termsVersion:body.termsVersion
    });
    if(!result||typeof result.code!=='string'||typeof result.ok!=='boolean')
      return send(503,'order_unavailable');

    if(result.ok===false){
      const denied=['not_owner','not_eligible'].includes(result.code);
      const conflict=result.code==='order_already_pending';
      const unpublished=result.code==='offer_not_published';
      return send(denied?403:conflict?409:unpublished?503:400,result.code);
    }
    if(!['transfer_order_pending','already_pending'].includes(result.code)
        ||!UUID.test(result.order_id||'')
        ||!/^CIT-[A-F0-9]{16}$/.test(result.reference||'')
        ||result.currency!=='ARS'
        ||!Number.isSafeInteger(Number(result.amount_minor))
        ||Number(result.amount_minor)<100
        ||result.paid!==false
        ||Number.isNaN(Date.parse(result.expires_at||'')))
       return send(503,'order_unavailable');

    return send(200,result.code,{
      order_id:result.order_id,reference:result.reference,
      amount_minor:Number(result.amount_minor),currency:'ARS',
      expires_at:result.expires_at,
      transfer_alias:ctx.alias,
      transfer_holder:ctx.holder.trim(),
      status:'pending',
      credited:false,
      message:'La solicitud no acredita un pago. El acceso pago solo se habilitará después de la conciliación de SpukLab.'
    });
  }catch{return send(503,'order_unavailable');}
}
