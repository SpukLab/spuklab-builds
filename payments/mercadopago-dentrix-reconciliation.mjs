import {inspectExistingPilotPayment} from './mercadopago-pilot-payment-audit.mjs';
export const APP='8696856635112318';
export const SELLER='3813812326';
export const BUYER='3813812328';
export const TENANT='50b3e3eb-77a5-413d-af3b-9aa5b56e833e';
export const OWNER='dentrix.8m@gmail.com';
const fail=code=>({ok:false,code,entitlement_activated:false});
/** All provider reads are authenticated GETs; only the service-only RPC records evidence. */
export async function reconcileDentrix({intent,buyerEmail,getProvider,commit,eventPaymentId}={}){
 if(intent?.stage!=='linked'||intent.live_mode!==false||intent.collector_id!==SELLER||intent.currency_id!=='ARS'||intent.amount_minor!==100000)
  return fail('linked_test_intent_required');
 if(typeof getProvider!=='function'||typeof commit!=='function')return fail('service_unavailable');
 let appMatches=false;
 const verified=await inspectExistingPilotPayment({
  intent,buyerId:BUYER,buyerEmail,includeEvidence:true,
  async getProvider(path){
   const value=await getProvider(path);
   if(path==='/preapproval/'+encodeURIComponent(intent.provider_subscription_id)){
    appMatches=String(value?.application_id)===APP;
    if(!appMatches)throw Error('provider_application_mismatch');
   }
   return value;
  }
 });
 if(!appMatches||!verified.ok)return fail(verified.code||'provider_evidence_unavailable');
 if(verified.verified_payments!==1||verified.evidence?.length!==1||verified.provider_live_mode_true!==true)
  return fail('single_test_payment_required');
 const evidence=verified.evidence[0];
 if(eventPaymentId!=null&&String(evidence.payment_id)!==String(eventPaymentId))return fail('different_payment');
 if(evidence.provider_live_mode!==true)return fail('provider_mode_unexpected');
 const result=await commit(evidence);
 if(!result?.ok||!['test_payment_reconciled','already_reconciled'].includes(result.code))
  return fail(result?.code||'reconciliation_unavailable');
 return {ok:true,code:result.code,amount_minor:100000,currency_id:'ARS',signed_event:true,entitlement_activated:false};
}
