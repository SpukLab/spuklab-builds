/**
 * PayPal SANDBOX webhook verification. A valid signature is NOT proof of payment.
 * This is a server-only helper, not a deployed endpoint or an entitlement writer.
 * https://developer.paypal.com/api/rest/webhooks/rest/
 */
const API='https://api-m.sandbox.paypal.com/v1/notifications/verify-webhook-signature';
const EVENT_TYPES=new Set([
 'BILLING.SUBSCRIPTION.ACTIVATED','BILLING.SUBSCRIPTION.CANCELLED',
 'BILLING.SUBSCRIPTION.SUSPENDED','BILLING.SUBSCRIPTION.EXPIRED',
 'BILLING.SUBSCRIPTION.UPDATED','PAYMENT.SALE.COMPLETED',
 'PAYMENT.SALE.DENIED','PAYMENT.SALE.REFUNDED','PAYMENT.SALE.REVERSED'
]);
const idPattern=/^[A-Za-z0-9-]{8,128}$/;
const fail=code=>({ok:false,code});
function header(headers,name){
 const value=typeof headers?.get==='function'?headers.get(name):
   headers?.[name]??headers?.[name.toLowerCase()];
 return typeof value==='string'?value:null;
}
export async function verifyPayPalSandboxWebhook({
 enabled=false,environment,webhookId,token,headers,event,fetchImpl
}={}){
 if(enabled!==true)return fail('disabled');
 if(environment!=='sandbox'||!idPattern.test(webhookId||'')||
   typeof token!=='string'||token.length<16||
   typeof fetchImpl!=='function')return fail('invalid_server_config');
 if(!event||typeof event!=='object'||Array.isArray(event)||
   !idPattern.test(event.id||'')||!EVENT_TYPES.has(event.event_type)||
   !event.resource||typeof event.resource!=='object'||Array.isArray(event.resource)||
   !idPattern.test(event.resource.id||''))return fail('invalid_event');
 const transmission_id=header(headers,'paypal-transmission-id');
 const transmission_sig=header(headers,'paypal-transmission-sig');
 const transmission_time=header(headers,'paypal-transmission-time');
 const auth_algo=header(headers,'paypal-auth-algo');
 const cert_url=header(headers,'paypal-cert-url');
 if(!idPattern.test(transmission_id||'')||
   !transmission_sig||!/^[A-Za-z0-9+/=]{20,4096}$/.test(transmission_sig)||
   !transmission_time||!Number.isFinite(Date.parse(transmission_time))||
   auth_algo!=='SHA256withRSA')return fail('invalid_signature_headers');
 let cert;
 try{cert=new URL(cert_url);}catch{return fail('invalid_certificate_url');}
 if(cert.protocol!=='https:'||cert.port||cert.username||cert.password||
   cert.hash||cert.search||
   !['api.sandbox.paypal.com','api-m.sandbox.paypal.com'].includes(cert.hostname)||
   !/^\/v1\/notifications\/certs\/CERT-[A-Za-z0-9-]{6,100}$/.test(cert.pathname))
   return fail('invalid_certificate_url');
 let body;
 try{body=JSON.stringify(event);}catch{return fail('invalid_event');}
 if(body.length>16384)return fail('event_too_large');
 try{
   const res=await fetchImpl(API,{
     method:'POST',headers:{
       Authorization:'Bearer '+token,'Content-Type':'application/json',
       Accept:'application/json'},
     body:JSON.stringify({
       auth_algo,cert_url:cert.href,transmission_id,
       transmission_sig,transmission_time,webhook_id:webhookId,
       webhook_event:event
     }),
     signal:AbortSignal.timeout(10000)
   });
   if(!res?.ok)return fail('verification_unavailable');
   const verification=await res.json();
   if(verification?.verification_status!=='SUCCESS')
     return fail('signature_not_verified');
   // Persist event ID and reconcile from PayPal using a separate trusted order.
   // Never promote subscriptions or enable tenant access on a webhook alone.
   return {ok:true,code:'signed_event_requires_reconciliation',
     event_id:event.id,event_type:event.event_type,
     provider_resource_id:event.resource.id,
     payment_confirmed:false,entitlement_activated:false};
 }catch{return fail('verification_unavailable');}
}
