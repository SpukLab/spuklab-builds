import test from 'node:test';
import assert from 'node:assert/strict';
import {closePreviousTest,OLD_APP} from './mercadopago-close-old-test.mjs';
import {TEST_SELLER,TEST_BUYER} from './mercadopago-dentrix-preflight.mjs';
function fixture(){
 const oldSubscription={id:'old-test',external_reference:'cithela_test_reference',collector_id:TEST_SELLER,payer_id:TEST_BUYER,application_id:OLD_APP,status:'authorized',auto_recurring:{transaction_amount:1000,currency_id:'ARS'}};
 let writes=0;
 const args={seller:{id:TEST_SELLER,site_id:'MLA',tags:['test_user']},buyer:{id:TEST_BUYER,site_id:'MLA'},buyerEmail:'test@example.invalid',buyerDigestMatches:true,oldIntent:{code:'snapshot',stage:'linked',live_mode:false,currency_id:'ARS',amount_minor:100000,collector_id:TEST_SELLER,provider_subscription_id:'old-test',external_reference:'cithela_test_reference'},oldSubscription,consent:true,update:async()=>{writes++;},read:async()=>({...oldSubscription,status:'cancelled'})};
 return {args,writes:()=>writes};
}
test('cancel only verified historic subscription and verify readback',async()=>{const f=fixture();assert.equal((await closePreviousTest(f.args)).code,'old_test_canceled');assert.equal(f.writes(),1);});
test('wrong app, seller, buyer, amount, currency, consent or reference never calls PUT',async()=>{
 for(const change of [a=>a.oldSubscription.application_id='wrong',a=>a.seller.tags=[],a=>a.buyerDigestMatches=false,a=>a.oldSubscription.auto_recurring.transaction_amount=500,a=>a.oldSubscription.auto_recurring.currency_id='USD',a=>a.consent=false,a=>a.oldSubscription.external_reference='other']){
 const f=fixture();change(f.args);assert.equal((await closePreviousTest(f.args)).ok,false);assert.equal(f.writes(),0);
 }
});
test('already canceled never calls PUT',async()=>{const f=fixture();f.args.oldSubscription.status='cancelled';assert.equal((await closePreviousTest(f.args)).code,'already_canceled');assert.equal(f.writes(),0);});
test('ambiguous response never retries PUT; requires fresh verified readback',async()=>{const f=fixture();f.args.update=async()=>{throw Error('timeout');};f.args.read=async()=>f.args.oldSubscription;assert.equal((await closePreviousTest(f.args)).code,'cancellation_not_verified');});
