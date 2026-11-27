import {inspectDentrixPreflight} from './mercadopago-dentrix-preflight.mjs';
export const OLD_APP='8696856635112318';
const fail=code=>({ok:false,code,charge_created:false,checkout_enabled:false});
export async function closePreviousTest({seller,buyer,oldIntent,oldSubscription,buyerEmail,buyerDigestMatches,consent,read,update}={}){
 if(consent!==true)return fail('explicit_consent_required');
 const check=s=>inspectDentrixPreflight({seller,buyer,oldIntent,oldSubscription:s,buyerEmail,buyerDigestMatches});
 const valid=s=>{
  const result=check(s);
  return result.seller_ok&&result.buyer_ok&&result.previous_verified&&result.previous_application===OLD_APP&&
    Number(s?.auto_recurring?.transaction_amount)===1000&&s?.auto_recurring?.currency_id==='ARS';
 };
 if(!valid(oldSubscription))return fail('old_test_identity_mismatch');
 if(check(oldSubscription).previous_closed)return {ok:true,code:'already_canceled',charge_created:false,checkout_enabled:false};
 if(!['authorized','pending','paused'].includes(oldSubscription.status))return fail('old_subscription_state_unknown');
 try{await update();}catch{/* Ambiguous PUT outcome: always check provider, never issue another PUT automatically. */}
 let verified;try{verified=await read();}catch{return fail('cancellation_not_verified');}
 if(!valid(verified)||!check(verified).previous_closed)return fail('cancellation_not_verified');
 return {ok:true,code:'old_test_canceled',charge_created:false,checkout_enabled:false};
}
