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
  if(request?.method!=='POST')return respond(405,'method_not_allowed');
  if(!config?.enabled || !config?.secret || !config?.merchantUserId ||
     typeof config?.liveMode!=='boolean' || typeof config?.storeSignedEvent!=='function')
     return respond(503,'not_configured');
  if(Number(request.headers.get('content-length')||0)>16384)return respond(413,'payload_too_large');
  const accepted=await verifyMercadoPagoSignature(request,config.secret);
  if(!accepted)return respond(401,'invalid_signature');
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
  const eventId=idString(body.id);
  const merchantUserId=idString(body.user_id,30);
  const requestId=request.headers.get('x-request-id');
  if(!eventId || !requestId || bodyResource!==signedResource ||
     topic!==body.type || merchantUserId!==config.merchantUserId ||
     body.live_mode!==config.liveMode)
    return respond(403,'notification_mismatch');
  const occurredAt=typeof body.date_created==='string' &&
       body.date_created.length<=50 && Number.isFinite(Date.parse(body.date_created))
       ?new Date(body.date_created).toISOString():null;
  try {
    // Store minimal signed event metadata only. Never persist raw body, token,
    // email, IP address, patient notes or financial claims from this request.
    const result=await config.storeSignedEvent({
      eventId,topic,resourceId:signedResource,requestId,merchantUserId,
      liveMode:body.live_mode,occurredAt
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
