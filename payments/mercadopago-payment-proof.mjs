/** CITHELA — payment evidence verification; server-only, no DB writes.
 * Subscription status or webhook payload alone is never payment proof.
 * Provider snapshots must be fetched from Mercado Pago authenticated API.
 */
const fail=code=>({ok:false,code,entitlement_activation_allowed:false});
export function verifySubscriptionPayment({intent,subscription,authorizedPayment,payment,verifiedTestSeller=false}={}){
 if(!intent||intent.live_mode!==false||intent.stage!=='linked'||
  !intent.provider_subscription_id||!subscription||!authorizedPayment||!payment)
  return fail('incomplete_evidence');
 if(subscription.id!==intent.provider_subscription_id||
  subscription.external_reference!==intent.external_reference||
  String(subscription.collector_id)!==String(intent.collector_id)||
  (subscription.live_mode===true ||
   (subscription.live_mode!==false && !(subscription.live_mode==null && verifiedTestSeller===true)))||
  subscription.auto_recurring?.currency_id!==intent.currency_id||
  Math.round(Number(subscription.auto_recurring?.transaction_amount)*100)!==intent.amount_minor)
  return fail('subscription_mismatch');
 if(String(authorizedPayment.preapproval_id)!==intent.provider_subscription_id||
  !authorizedPayment.payment?.id && !authorizedPayment.payment_id)
  return fail('invoice_mismatch');
 const invoicePaymentId=authorizedPayment.payment?.id??authorizedPayment.payment_id;
 if(String(invoicePaymentId)!==String(payment.id)||
  payment.status!=='approved'||!payment.date_approved||
  payment.currency_id!==intent.currency_id||
  !Number.isFinite(Number(payment.transaction_amount))||
  Math.round(Number(payment.transaction_amount)*100)!==intent.amount_minor||
  String(payment.collector_id)!==String(intent.collector_id)||
  payment.live_mode!==false)
  return fail('payment_not_verified');
 return {ok:true,code:'approved_payment_verified',
  payment_id:String(payment.id),subscription_id:intent.provider_subscription_id,
  entitlement_activation_allowed:false};
}
