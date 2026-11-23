/**
 * Recover the existing, linked internal test subscription URL.
 * Pure validation: never creates, cancels or changes subscriptions/payments.
 */
import {verifyTestProviderIdentity} from './mercadopago-test-provider.mjs';
const deny=code=>({ok:false,code});
const ID=/^[A-Za-z0-9_-]{1,120}$/;
const parsedAmount=value=>{
 if(typeof value==='number'&&Number.isFinite(value))return value;
 if(typeof value==='string'&&/^\d+(?:\.\d{1,2})?$/.test(value))return Number(value);
 return null;
};
export function verifyLinkedTestCheckout({intent,detail,buyerId,verifiedTestSeller=false,verifiedTestBuyer=false}={}){
 if(intent?.stage!=='linked'||intent?.live_mode!==false||
    intent?.currency_id!=='ARS'||!ID.test(intent?.provider_subscription_id||''))
   return deny('linked_test_subscription_required');
 if(verifiedTestSeller!==true||verifiedTestBuyer!==true)
   return deny('test_accounts_unverified');
 if(!detail||detail.id!==intent.provider_subscription_id||
    detail.status!=='pending'||String(detail.payer_id||'')!==String(buyerId||'')||
    !/^[0-9]{1,30}$/.test(String(buyerId||'')))
   return deny('provider_identity_mismatch');
 const proof=verifyTestProviderIdentity({
    live_mode:false,currency_id:'ARS',external_reference:intent.external_reference,
    amount_minor:intent.amount_minor,collector_id:intent.collector_id,
    terms_version:'internal-test-only-v1'
 },{
    ok:true,code:'read_only',provider_subscription_id:detail.id,
    external_reference:detail.external_reference,collector_id:detail.collector_id,
    live_mode:detail.live_mode,currency_id:detail.auto_recurring?.currency_id,
    amount:parsedAmount(detail.auto_recurring?.transaction_amount),
    status:detail.status
 },{verifiedTestSeller:true});
 if(!proof.ok)return deny('provider_identity_mismatch');
 let url;
 try{url=new URL(detail?.init_point||'');}catch{return deny('invalid_checkout_url');}
 if(url.protocol!=='https:'||url.username||url.password||
   !/(^|\.)mercadopago\.(com|com\.ar)$/.test(url.hostname)||
   !url.pathname.startsWith('/subscriptions/checkout'))
   return deny('invalid_checkout_url');
 return {ok:true,code:'linked_test_checkout_recovered',checkout_url:url.href};
}
