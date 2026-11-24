/**
 * CITHELA internal read-only audit. Retrieves the already-issued subscription
 * invoices from Mercado Pago and verifies the original charge through their API.
 * No payment creation, DB writes, entitlement activation or webhook bypass.
 */
import {verifySubscriptionPayment,verifyInternalTestAccountPayment,diagnosePaymentProofMismatch} from './mercadopago-payment-proof.mjs';
const numeric=/^[0-9]{1,30}$/;
const ref=/^[a-zA-Z0-9_-]{1,120}$/;
const fail=(code,checks=[])=>({ok:false,code,...(checks.length?{checks}: {})});
const safeStr=x=>x==null?'':String(x);
const sellerIsTest=(seller,expected)=>safeStr(seller?.id)===safeStr(expected)&&
 seller?.site_id==='MLA'&&Array.isArray(seller?.tags)&&seller.tags.includes('test_user');

/**
 * @param {{intent?: any, getProvider?: (path:string)=>Promise<any>,
 * buyerId?: string, buyerEmail?: string, includeEvidence?: boolean}} args
 * @returns {Promise<any>}
 */
export async function inspectExistingPilotPayment({intent,getProvider,buyerId,buyerEmail,includeEvidence=false}={}){
 if(!intent||intent.stage!=='linked'||intent.live_mode!==false||
   intent.currency_id!=='ARS'||intent.amount_minor!==100000||
   !numeric.test(safeStr(intent.collector_id))||!numeric.test(safeStr(buyerId))||
   !ref.test(intent.provider_subscription_id||''))
   return fail('linked_test_intent_required');
 if(typeof getProvider!=='function')return fail('provider_reader_missing');

 const [seller,subscription]=await Promise.all([
  getProvider('/users/me'),
  getProvider('/preapproval/'+encodeURIComponent(intent.provider_subscription_id))
 ]);
 const sellerVerified=sellerIsTest(seller,intent.collector_id);
 if(!sellerVerified)return fail('test_seller_not_verified');
 if(!subscription||subscription.id!==intent.provider_subscription_id||
    safeStr(subscription.payer_id)!==safeStr(buyerId)||
    subscription.external_reference!==intent.external_reference||
    safeStr(subscription.collector_id)!==safeStr(intent.collector_id)||
    subscription.live_mode===true)
   return fail('subscription_identity_mismatch');

 // The API's documented primary filter is preapproval_id. Request the
 // default page with no optional limit/offset (provider reported HTTP 400
 // when our previous pilot sent both). If that exact search is rejected,
 // try the documented payer_id filter, then keep ONLY invoices from the
 // original linked subscription. No unfiltered search is permitted.
 let page;
 let usedPayerFallback=false;
 try{
  page=await getProvider('/authorized_payments/search?'+
   new URLSearchParams({preapproval_id:intent.provider_subscription_id}));
 }catch(error){
  if(!(error instanceof Error)||error.message!=='mp_invoice_search_http_400')
   throw error;
  usedPayerFallback=true;
  page=await getProvider('/authorized_payments/search?'+
   new URLSearchParams({payer_id:String(buyerId)}));
 }
 if(!Array.isArray(page?.results)||!Number.isSafeInteger(page?.paging?.total)||
    page.paging.total<0)
  return fail('invoice_search_incomplete');
 // One-time internal pilot: fail closed rather than silently accepting a
 // truncated history or paging through unknown provider request variants.
 if(page.paging.total>500)return fail('invoice_search_incomplete');
 if(page.paging.total>20)return fail('too_many_invoices_for_pilot');
 if(page.results.length!==page.paging.total)
  return fail('invoice_search_incomplete');
 const invoices=usedPayerFallback
  ?page.results.filter(row=>row?.preapproval_id===intent.provider_subscription_id)
  :page.results;
 if(invoices.length===0)return fail('invoice_not_found');

 let verifiedCount=0;
 let trueModeTestCount=0;
 const evidence=[];
 let firstFailure='no_approved_invoice';
 const failedChecks=new Set();
 const seen=new Set();
 for(const summary of invoices){
  const invoiceId=safeStr(summary?.id);
  if(!numeric.test(invoiceId)||seen.has(invoiceId))
   return fail('invoice_identity_ambiguous');
  seen.add(invoiceId);
  if(summary?.preapproval_id!==intent.provider_subscription_id)
   return fail('invoice_wrong_subscription');

  const invoice=await getProvider('/authorized_payments/'+invoiceId);
  const payId=safeStr(invoice?.payment?.id??invoice?.payment_id);
  if(safeStr(invoice?.id)!==invoiceId||
    invoice?.preapproval_id!==intent.provider_subscription_id||
    !numeric.test(payId)) {
   firstFailure='invoice_no_payment_reference';
   continue;
  }
  const payment=await getProvider('/v1/payments/'+payId);
  let proof=verifySubscriptionPayment({
   intent,subscription,authorizedPayment:invoice,payment,verifiedTestSeller:sellerVerified
  });
  // Only after strict verifier rejects for the single provider mode flag:
  // check the exact configured test buyer via an independent GET.
  if(!proof.ok&&proof.code==='payment_not_verified'&&
      payment?.live_mode===true&&
      diagnosePaymentProofMismatch({intent,authorizedPayment:invoice,payment})
        .join(',')==='payment_mode_true'){
   const buyer=await getProvider('/users/'+encodeURIComponent(String(buyerId)));
   const email=typeof buyerEmail==='string'?buyerEmail.trim().toLowerCase():'';
   const buyerVerified=!!email&&email.length<255&&
    safeStr(buyer?.id)===safeStr(buyerId)&&buyer?.site_id==='MLA'&&
    (buyer.email==null||
     (typeof buyer.email==='string'&&buyer.email.toLowerCase()===email))&&
    (!Array.isArray(buyer?.tags)||buyer.tags.includes('test_user'));
   proof=verifyInternalTestAccountPayment({
    intent,subscription,authorizedPayment:invoice,payment,buyerId,
    verifiedTestSeller:sellerVerified,verifiedTestBuyer:buyerVerified
   });
  }
  if(proof.ok){
   if(proof.provider_live_mode_true===true){
    trueModeTestCount++;
    if(includeEvidence===true){
     evidence.push({
      invoice_id:invoiceId,payment_id:payId,
      approved_at:payment.date_approved,provider_live_mode:true
     });
    }
   }
   if(!Number.isFinite(Date.parse(payment.date_approved)))
     return fail('invalid_approval_date');
   verifiedCount++;
  }else{
   firstFailure=proof.code;
   if(proof.code==='payment_not_verified'){
    for(const code of diagnosePaymentProofMismatch({intent,authorizedPayment:invoice,payment})){
     failedChecks.add(code);
    }
   }
  }
 }
 if(verifiedCount===0)return fail(firstFailure,[...failedChecks]);
 return {ok:true,code:'approved_test_payment_verified_read_only',
   verified_payments:verifiedCount,
   provider_live_mode_true:trueModeTestCount>0,
   entitlement_activation_allowed:false,
   ...(includeEvidence===true?{evidence}:{})};
}
