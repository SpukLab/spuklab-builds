/**
 * CITHELA internal read-only audit. Retrieves the already-issued subscription
 * invoices from Mercado Pago and verifies the original charge through their API.
 * No payment creation, DB writes, entitlement activation or webhook bypass.
 */
import {verifySubscriptionPayment} from './mercadopago-payment-proof.mjs';
const numeric=/^[0-9]{1,30}$/;
const ref=/^[a-zA-Z0-9_-]{1,120}$/;
const fail=code=>({ok:false,code});
const safeStr=x=>x==null?'':String(x);
const sellerIsTest=(seller,expected)=>safeStr(seller?.id)===safeStr(expected)&&
 seller?.site_id==='MLA'&&Array.isArray(seller?.tags)&&seller.tags.includes('test_user');

export async function inspectExistingPilotPayment({intent,getProvider,buyerId}={}){
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

 const invoices=[];
 let total=null;
 for(let offset=0;offset<500;offset+=50){
  const q=new URLSearchParams({
    preapproval_id:intent.provider_subscription_id,limit:'50',offset:String(offset)
  });
  const page=await getProvider('/authorized_payments/search?'+q);
  if(!Array.isArray(page?.results)||!Number.isSafeInteger(page?.paging?.total)||
     page.paging.total<0||page.paging.total>500||
     (total!==null&&total!==page.paging.total))
   return fail('invoice_search_incomplete');
  total=page.paging.total;
  invoices.push(...page.results);
  if(invoices.length===total)break;
  if(invoices.length>total||page.results.length===0)
   return fail('invoice_search_incomplete');
 }
 if(invoices.length!==total)return fail('invoice_search_incomplete');
 if(invoices.length===0)return fail('invoice_not_found');
 if(invoices.length>20)return fail('too_many_invoices_for_pilot');

 let verifiedCount=0;
 let firstFailure='no_approved_invoice';
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
  const proof=verifySubscriptionPayment({
   intent,subscription,authorizedPayment:invoice,payment,verifiedTestSeller:sellerVerified
  });
  if(proof.ok){
   if(!Number.isFinite(Date.parse(payment.date_approved)))
     return fail('invalid_approval_date');
   verifiedCount++;
  }else{
   firstFailure=proof.code;
  }
 }
 if(verifiedCount===0)return fail(firstFailure);
 return {ok:true,code:'approved_test_payment_verified_read_only',
   verified_payments:verifiedCount,
   entitlement_activation_allowed:false};
}
