// Pure checks for the second internal pilot. Never authorizes a charge.
export const DENTRIX_TENANT='50b3e3eb-77a5-413d-af3b-9aa5b56e833e';
export const DENTRIX_OWNER='dentrix.8m@gmail.com';
export const ALMA_TENANT='e680ebd3-a031-4968-905a-e829ab3b5dfe';
export const COMMERCIAL_APP='1991128674423369';
export const PANEL_APP='8696856635112318'; // actual application of the fictitious seller, validated 27 Nov
export const TEST_SELLER='3813812326';
export const TEST_BUYER='3813812328';
const same=(a,b)=>a!=null&&String(a)===b;
export function isDentrixOwner(user,snapshot){
 return !!user?.email_confirmed_at&&user?.email?.toLowerCase()===DENTRIX_OWNER&&
 snapshot?.ok===true&&['no_subscription','snapshot'].includes(snapshot.code);
}
export function inspectDentrixPreflight({seller,buyer,oldIntent,oldSubscription,buyerEmail,buyerDigestMatches}={}){
 const seller_ok=same(seller?.id,TEST_SELLER)&&seller?.site_id==='MLA'&&
  Array.isArray(seller?.tags)&&seller.tags.includes('test_user');
 const buyer_ok=buyerDigestMatches===true&&same(buyer?.id,TEST_BUYER)&&buyer?.site_id==='MLA'&&
  typeof buyerEmail==='string'&&buyerEmail.length>0&&
  (buyer.email==null||(typeof buyer.email==='string'&&buyer.email.toLowerCase()===buyerEmail.toLowerCase()))&&
  (!Array.isArray(buyer.tags)||buyer.tags.includes('test_user'));
 const previous_verified=oldIntent?.code==='snapshot'&&oldIntent.stage==='linked'&&
  oldIntent.live_mode===false&&oldIntent.currency_id==='ARS'&&oldIntent.amount_minor===100000&&
  same(oldIntent.collector_id,TEST_SELLER)&&oldSubscription?.id===oldIntent.provider_subscription_id&&
  oldSubscription.external_reference===oldIntent.external_reference&&same(oldSubscription.collector_id,TEST_SELLER)&&
  same(oldSubscription.payer_id,TEST_BUYER)&&oldSubscription.live_mode!==true;
 const previous_application=previous_verified&&oldSubscription.application_id!=null?
  String(oldSubscription.application_id):null;
 const application_matches=previous_application===null?null:previous_application===PANEL_APP;
 const previous_status=previous_verified&&['pending','authorized','paused','cancelled','canceled'].includes(oldSubscription.status)?
  oldSubscription.status:'unknown';
 // Require cancelled, not merely paused: a paused recurring subscription can be resumed.
 const previous_closed=['cancelled','canceled'].includes(previous_status);
 const code=!seller_ok?'seller_not_verified':!buyer_ok?'buyer_not_verified':
  !previous_verified?'previous_subscription_unverified':application_matches===null?'application_unknown':
  !application_matches?'application_mismatch':!previous_closed?'previous_subscription_not_closed':
  'preflight_checks_passed';
 return {ok:code==='preflight_checks_passed',code,seller_ok,buyer_ok,previous_verified,previous_application,
  application_matches,previous_status,previous_closed,checkout_enabled:false,charge_created:false};
}
