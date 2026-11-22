import test from 'node:test';
import assert from 'node:assert/strict';
import {runPilotCheckout} from './mercadopago-pilot-checkout.mjs';

function fixture() {
  const reference = 'cithela_1234567890123456';
  const snapshot = {id:'sub_1',external_reference:reference,collector_id:123,
    payer_id:456,live_mode:false,status:'pending',
    auto_recurring:{currency_id:'ARS',transaction_amount:15},
    init_point:'https://www.mercadopago.com.ar/example'};
  const calls = {posts:0,links:0};
  const input = {
    request:{tenantId:'e680ebd3-a031-4968-905a-e829ab3b5dfe',consent:true},
    actor:{id:'owner',email:'alma.y.pampa@gmail.com',emailConfirmed:true},
    token:'APP_USR-1234567890123456',
    services:{
      enabled:true,
      preflight:async()=>({ok:true,code:'eligible'}),
      verifyAccounts:async()=>({sellerVerified:true,buyerVerified:true,buyerId:456,buyerEmail:'test@example.com'}),
      prepare:async()=>({ok:true,intent_id:'intent',stage:'prepared',external_reference:reference,
        collector_id:'123',currency_id:'ARS',amount_minor:1500,live_mode:false,terms_version:'internal-test-only-v1'}),
      claim:async()=>({ok:true,code:'claimed',external_reference:reference}),
      searchSubscriptions:async()=>({complete:true,results:[snapshot]}),
      link:async()=>{calls.links++;return {ok:true};}
    },
    fetchImpl:async(_url,options)=>{
      if(options.method==='POST') calls.posts++;
      return Response.json(snapshot);
    }
  };
  return {input,calls,snapshot};
}

test('checkout returns a link only after verifying and binding the test subscription',async()=>{
  const {input,calls,snapshot}=fixture();
  assert.equal((await runPilotCheckout(input)).checkout_url,snapshot.init_point);
  assert.deepEqual(calls,{posts:1,links:1});
});

test('recovery binds a unique match without creating another subscription',async()=>{
  const {input,calls,snapshot}=fixture();
  input.services.claim=async()=>({ok:true,code:'recover_only',external_reference:snapshot.external_reference});
  assert.equal((await runPilotCheckout(input)).code,'checkout_ready');
  assert.deepEqual(calls,{posts:0,links:1});
});

test('production evidence and unverified accounts never yield checkout links',async()=>{
  const {input,calls,snapshot}=fixture();
  input.services.verifyAccounts=async()=>({sellerVerified:true,buyerVerified:false});
  assert.equal((await runPilotCheckout(input)).code,'test_accounts_unverified');
  assert.deepEqual(calls,{posts:0,links:0});
  const live=fixture();
  live.snapshot.live_mode=true;
  assert.equal((await runPilotCheckout(live.input)).code,'provider_identity_mismatch');
  assert.equal(live.calls.links,0);
  assert.equal(snapshot.live_mode,false);
});
