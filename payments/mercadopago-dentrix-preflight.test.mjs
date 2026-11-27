import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectDentrixPreflight,isDentrixOwner,DENTRIX_OWNER,PANEL_APP,TEST_SELLER,TEST_BUYER} from './mercadopago-dentrix-preflight.mjs';
const fixture=()=>({seller:{id:TEST_SELLER,site_id:'MLA',tags:['test_user']},buyer:{id:TEST_BUYER,site_id:'MLA'},buyerEmail:'buyer@example.invalid',buyerDigestMatches:true,
 oldIntent:{code:'snapshot',stage:'linked',live_mode:false,currency_id:'ARS',amount_minor:100000,collector_id:TEST_SELLER,provider_subscription_id:'old-test',external_reference:'cithela_test_reference'},
 oldSubscription:{id:'old-test',external_reference:'cithela_test_reference',collector_id:TEST_SELLER,payer_id:TEST_BUYER,application_id:PANEL_APP,status:'cancelled'}});
test('confirmed Dentrix owner only; no commercial state change required',()=>{
 const u={email:DENTRIX_OWNER,email_confirmed_at:'verified'};
 assert.equal(isDentrixOwner(u,{ok:true,code:'no_subscription'}),true);
 assert.equal(isDentrixOwner({...u,email:'other@example.invalid'},{ok:true,code:'no_subscription'}),false);
 assert.equal(isDentrixOwner(u,{ok:false,code:'not_tenant_owner'}),false);
 assert.equal(isDentrixOwner({...u,email_confirmed_at:null},{ok:true,code:'no_subscription'}),false);
});
test('matching application and closed previous subscription passes diagnostic, never enables checkout',()=>{
 const result=inspectDentrixPreflight(fixture());
 assert.equal(result.code,'preflight_checks_passed');
 assert.equal(result.checkout_enabled,false);
 assert.equal(result.charge_created,false);
});
test('different or missing application never authorizes a new attempt',()=>{
 const f=fixture(); f.oldSubscription.application_id='123';
 assert.equal(inspectDentrixPreflight(f).code,'application_mismatch');
 delete f.oldSubscription.application_id;
 assert.equal(inspectDentrixPreflight(f).code,'application_unknown');
});
test('active or paused previous subscription is not closed',()=>{
 for(const status of ['authorized','pending','paused','unknown']){
  const f=fixture();f.oldSubscription.status=status;
  assert.equal(inspectDentrixPreflight(f).code,'previous_subscription_not_closed');
 }
});
test('seller, buyer, subscription and credentials must match',()=>{
 let f=fixture();f.seller.tags=[];assert.equal(inspectDentrixPreflight(f).code,'seller_not_verified');
 f=fixture();f.buyerDigestMatches=false;assert.equal(inspectDentrixPreflight(f).code,'buyer_not_verified');
 f=fixture();f.oldSubscription.external_reference='unrelated';assert.equal(inspectDentrixPreflight(f).code,'previous_subscription_unverified');
 f=fixture();f.oldSubscription.payer_id='other';assert.equal(inspectDentrixPreflight(f).code,'previous_subscription_unverified');
});
