/**
 * Mercado Pago signed notification receiver. Pure HTTP logic, server only.
 * A valid HMAC allows durable inbox recording, NEVER payment activation.
 * The caller injects a server-only persistence function.
 */
import {verifyMercadoPagoSignature} from './mercadopago-webhook-signature.mjs';

const TOPICS=new Set(['subscription_preapproval','subscription_authorized_payment','payment']);
const HEADERS={'content-type':'application/json; charset=utf-8','cache-control':'no-store'};
const respond=(status,code)=>new Response(JSON.stringify({ok:status===200,code}),{status,headers:HEADERS});
const idString=(value,max=120)=>{
  if(typeof value==='number'&&Number.isSafeInteger(value)&&value>=0) return String(value);
  if(typeof value==='string'&&/^[A-Za-z0-9_-]+$/.test(value)&&value.length<=max) return value;
  return null;
};

export async function handleMercadoPagoWebhook(request, config) {
  const ready=!!(config?.enabled && config?.secret && config?.merchantUserId &&
     typeof config?.liveMode==='boolean' && typeof config?.storeSignedEvent==='function');
  // No secret names, lengths, values or identities in the diagnostic response.
  // Does not authenticate payments or change billing state.
  if(request?.method==='GET'){
    try{
      const u=new URL(request.url);
      if(u.searchParams.get('health')==='1')
        return respond(ready?200:503,ready?'webhook_configured':'not_configured');
    }catch{ /* malformed request */ }
  }
  if(request?.method!=='POST')return respond(405,'method_not_allowed');
  if(!ready)return respond(503,'not_configured');
  if(Number(request.headers.get('content-length')||0)>16384)return respond(413,'payload_too_large');
  const accepted=await verifyMercadoPagoSignature(request,config.secret);
  if(!accepted){
    // Only the rejection category is sent to the server's diagnostic logger.
    // Do not log headers, timestamps, resource IDs or any request payload.
    try {config.reportValidationFailure?.('invalid_signature');}catch{}
    return respond(401,'invalid_signature');
  }
  // Mercado Pago SDK recommends a five-minute timestamp tolerance. An
  // authentic but previously recorded signed payload must not be replayed
  // indefinitely, even if a database event has not yet been persisted.
  const signedHeader=request.headers.get('x-signature')||'';
  const signedTimestamp=/(?:^|,)ts=(\d{10,16})(?:,|$)/.exec(signedHeader)?.[1];
  const timestampValue=signedTimestamp?Number(signedTimestamp):NaN;
  const epochMillis=signedTimestamp&&signedTimestamp.length>=13
    ?timestampValue:timestampValue*1000;
  const nowMillis=Number.isFinite(config.nowMs)?config.nowMs:Date.now();
  if(!Number.isSafeInteger(timestampValue)||
     !Number.isFinite(epochMillis)||
     Math.abs(nowMillis-epochMillis)>5*60*1000)
    {try {config.reportValidationFailure?.('signature_expired');}catch{}
    return respond(401,'signature_expired');}
  const url=new URL(request.url);
  const types=url.searchParams.getAll('type');
  const ids=url.searchParams.getAll('data.id');
  if(types.length!==1 || !TOPICS.has(types[0]) || ids.length!==1)
    return respond(400,'unsupported_notification');
  const signedResource=ids[0];
  let raw,body;
  try {
    raw=await request.text();
    if(raw.length>16384)return respond(413,'payload_too_large');
    body=JSON.parse(raw);
  } catch {return respond(400,'invalid_json');}
  if(!body||typeof body!=='object'||Array.isArray(body))
    return respond(400,'invalid_notification');
  const topic=types[0];
  const bodyResource=idString(body.data?.id,200);
  const requestId=request.headers.get('x-request-id');
  // Mercado Pago's "Simular notificaciones" uses a legacy payload without
  // user_id/live_mode. It can also send subscription_authorized_payment in the
  // query while the body says subscription_preapproval/entity=preapproval.
  // Accept only this EXACT test-simulator shape after successful HMAC.
  // Store it as a test inbox entry; never infer entitlement or payment status.
  const simulated= config.liveMode===false &&
    topic==='subscription_authorized_payment' &&
    body?.type==='subscription_preapproval' &&
    body?.entity==='preapproval' && body?.action==='updated' &&
    Number.isSafeInteger(body.version) && body.version>=0 &&
    body.user_id===undefined && body.live_mode===undefined &&
    String(body.id||'')===signedResource &&
    bodyResource===signedResource &&
    typeof body.date==='string' && body.date.length<=50 &&
    Number.isFinite(Date.parse(body.date));
  const merchantUserId=simulated?config.merchantUserId:idString(body.user_id,30);
  const storedTopic=simulated?'subscription_preapproval':topic;
  const eventId=simulated && requestId?.length<=115
    ?'sim_'+requestId:idString(body.id);
  if(!eventId || !requestId || bodyResource!==signedResource ||
     (!simulated && (topic!==body.type || body.live_mode!==config.liveMode)) ||
     merchantUserId!==config.merchantUserId)
    return respond(403,'notification_mismatch');
  const occurredAt=!simulated && typeof body.date_created==='string' &&
       body.date_created.length<=50 && Number.isFinite(Date.parse(body.date_created))
       ?new Date(body.date_created).toISOString():null;
  try {
    // Store minimal signed event metadata only. Never persist raw body, token,
    // email, IP address, patient notes or financial claims from this request.
    const result=await config.storeSignedEvent({
      eventId,topic:storedTopic,resourceId:signedResource,requestId,merchantUserId,
      liveMode:simulated?false:body.live_mode,occurredAt
    });
    if(result?.ok && (result.code==='recorded'||result.code==='duplicate'))
      return respond(200,result.code);
    if(result?.code==='event_id_conflict')return respond(409,'event_conflict');
    return respond(503,'storage_unavailable');
  } catch {
    // A failed durable write must NOT return 200. Let Mercado Pago retry.
    return respond(503,'storage_unavailable');
  }
}
