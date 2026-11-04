/**
 * CITHELA — test-only opt-in intent. No provider call or payment operation.
 * The server supplies price, seller and buyer identity, never the browser.
 */
const HEADERS={'content-type':'application/json; charset=utf-8',
 'cache-control':'no-store','access-control-allow-origin':'https://spuklab.github.io',
 'access-control-allow-methods':'POST, OPTIONS',
 'access-control-allow-headers':'authorization,apikey,content-type,x-client-info',
 'vary':'Origin'};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MONEY_MIN=100, MONEY_MAX=100000000000;
const respond=(status,code,extra={})=>Response.json({ok:status===200,code,...extra},
 {status,headers:HEADERS});

export async function handleCithelaMpTestIntent(request,settings){
 if(request?.method==='OPTIONS')return new Response(null,{status:204,headers:HEADERS});
 if(request?.method!=='POST')return respond(405,'method_not_allowed');
 if(request.headers.get('origin')!=='https://spuklab.github.io')
   return respond(403,'origin_not_allowed');
 // The feature remains disabled until the price and terms are approved.
 if(!settings?.enabled || !/^[0-9]{1,30}$/.test(settings.merchantUserId||'') ||
    !Number.isSafeInteger(settings.amountMinor) ||
    settings.amountMinor<MONEY_MIN || settings.amountMinor>MONEY_MAX ||
    typeof settings.resolveActor!=='function' || typeof settings.prepareIntent!=='function')
   return respond(503,'test_checkout_not_enabled');

 if(Number(request.headers.get('content-length')||0)>4096)
   return respond(413,'request_too_large');
 let body;
 try{
   const text=await request.text();
   if(text.length>4096)return respond(413,'request_too_large');
   body=JSON.parse(text);
 }catch{return respond(400,'invalid_request');}
 if(!body||typeof body!=='object'||Array.isArray(body)||
    Object.keys(body).sort().join(',')!=='consent,tenantId,termsVersion' ||
    !UUID.test(body.tenantId||'') ||
    body.termsVersion!=='internal-test-only-v1' ||
    body.consent!==true)
   return respond(400,'explicit_test_consent_required');
 const auth=/^Bearer\s+([^\s]+)$/i.exec(request.headers.get('authorization')||'');
 if(!auth)return respond(401,'unauthenticated');
 let actor;
 try{actor=await settings.resolveActor(auth[1]);}catch{return respond(503,'auth_unavailable');}
 if(!actor || !UUID.test(actor.id||''))return respond(401,'unauthenticated');
 if(actor.emailConfirmed!==true)return respond(403,'email_not_verified');

 // This is not a Mercado Pago idempotency key: a single open intent per tenant
 // is also enforced by the database unique index and row lock.
 const reference='cithela_'+settings.randomUUID().replaceAll('-','');
 try{
   const response=await settings.prepareIntent({
     tenantId:body.tenantId,
     ownerUserId:actor.id,
     externalReference:reference,
     collectorId:settings.merchantUserId,
     amountMinor:settings.amountMinor,
     termsVersion:'internal-test-only-v1'
   });
   if(response?.ok===true &&
      (response.code==='prepared'||response.code==='already_prepared') &&
      UUID.test(response.intent_id||'') &&
      /^cithela_[a-zA-Z0-9_-]{12,100}$/.test(response.external_reference||''))
     return respond(200,response.code,{
       test_only:true,
       intent_id:response.intent_id,
       external_reference:response.external_reference,
       payment_created:false
     });
   if(response?.code==='not_eligible')return respond(403,'not_eligible');
   if(response?.code==='existing_intent_conflict')return respond(409,'existing_intent_conflict');
   if(response?.code==='already_in_progress')return respond(409,'already_in_progress');
   return respond(503,'intent_unavailable');
 }catch{return respond(503,'intent_unavailable');}
}
