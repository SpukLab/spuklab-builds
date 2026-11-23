/**
 * CITHELA: fail-closed preapproval recovery decision.
 * A POST timeout is ambiguous. Never create a second subscription blindly.
 * Only a matching, provider-verified snapshot can be linked.
 * This pure module performs no network calls and changes no entitlements.
 */
const ID=/^[A-Za-z0-9_-]{1,120}$/;
export function decideTestCheckoutRecovery({intent,providerSnapshots,lookupComplete=false,verifiedTestSeller=false}={}){
 if(!intent||intent.live_mode!==false||intent.stage!=='prepared'||
    !/^cithela_[A-Za-z0-9_-]{12,100}$/.test(intent.external_reference||''))
   return {ok:false,code:'invalid_intent',may_create:false};
 if(!lookupComplete||!Array.isArray(providerSnapshots))
   return {ok:false,code:'provider_lookup_incomplete',may_create:false};
 const matches=providerSnapshots.filter(s=>
   s?.external_reference===intent.external_reference);
 if(matches.length!==1)
   return {ok:false,code:matches.length===0?'unresolved_provider_outcome':'ambiguous_provider_matches',
     may_create:false};
 const s=matches[0];
 if(!ID.test(s.id||'')||
    (s.live_mode===true||
     (s.live_mode!==false&&!(s.live_mode==null&&verifiedTestSeller===true)))||
    String(s.collector_id)!==String(intent.collector_id)||
    s.auto_recurring?.currency_id!=='ARS'||
    !(typeof s.auto_recurring?.transaction_amount==='number'||
      (typeof s.auto_recurring?.transaction_amount==='string' &&
       /^\d+(?:\.\d{1,2})?$/.test(s.auto_recurring.transaction_amount)))||
    Math.round(Number(s.auto_recurring.transaction_amount)*100)!==intent.amount_minor)
   return {ok:false,code:'provider_identity_mismatch',may_create:false};
 return {ok:true,code:'verified_existing_preapproval',may_create:false,
   provider_subscription_id:s.id,payment_verified:false,
   entitlement_activation_allowed:false};
}
