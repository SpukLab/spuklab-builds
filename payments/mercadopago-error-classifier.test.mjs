import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyPreapprovalValidation,safePreapprovalErrorMetadata} from './mercadopago-error-classifier.mjs';
import {createTestPreapproval} from './mercadopago-test-provider.mjs';
const intent={live_mode:false,currency_id:'ARS',external_reference:'cithela_abcdefgh12345678',amount_minor:1000,terms_version:'internal-test-only-v1',collector_id:'3813812326'};
const payerEmail='test_buyer_123@testuser.com', backUrl='https://spuklab.github.io/spuklab-builds/cithela/suscripcion-prueba.html';
const token='APP_USR-fake-testing-credential-1234567890';
test('classifies exact known provider errors with fixed enums',()=>{
 assert.equal(classifyPreapprovalValidation({message:'Both payer and collector must be real or test users'}),'payer_collector_mode_mismatch');
 assert.equal(classifyPreapprovalValidation({cause:[{code:'invalid_transaction_amount',description:'transaction_amount must be at least 100'}]}),'amount_invalid');
 assert.equal(classifyPreapprovalValidation({message:'Invalid payer_email'}),'payer_email_invalid');
 assert.equal(classifyPreapprovalValidation({message:'Invalid back_url'}),'return_url_invalid');
 assert.equal(classifyPreapprovalValidation({message:'Some unknown error occurred'}),'validation_unknown');
});
test('never includes arbitrary provider text or personal identifiers in diagnostic result',()=>{
 const marker='private.buyer@testuser.com APP_USR-SECRET 123456789';
 assert.equal(classifyPreapprovalValidation({message:marker}),'validation_unknown');
 assert.equal(classifyPreapprovalValidation({cause:[{description:marker}]}),'validation_unknown');
 assert.equal(classifyPreapprovalValidation({message:null,cause:'invalid'}),'validation_unknown');
});
test('HTTP 400 category is logged safely and attempt stays pending',async()=>{
 const logged=[],oldWarn=console.warn;
 console.warn=(...items)=>logged.push(items.join(' '));
 try {
   const result=await createTestPreapproval({
      intent,payerEmail,backUrl,token,fetchImpl:async()=>Response.json({
        message:'Both payer and collector must be real or test users',
        access_token:'APP_USR-secret',payer_email:'private@mp.test'
      },{status:400})
   });
   assert.deepEqual(result,{ok:false,code:'provider_validation_rejected'});
   const output=logged.join(' ');
   assert.match(output,/payer_collector_mode_mismatch/);
   assert.match(output,/"http_status":400/);
   assert.doesNotMatch(output,/Both payer|APP_USR-secret|private@mp\.test|test_buyer_/);
 }finally{console.warn=oldWarn;}
});
test('malformed error body preserves fail-closed public response',async()=>{
 const logged=[],oldWarn=console.warn;
 console.warn=(...items)=>logged.push(items.join(' '));
 try{
 const result=await createTestPreapproval({intent,payerEmail,backUrl,token,
  fetchImpl:async()=>new Response('private raw details',{status:400,headers:{'content-type':'text/plain'}})});
 assert.deepEqual(result,{ok:false,code:'provider_validation_rejected'});
 assert.match(logged.join(' '),/not_applicable/);
 assert.doesNotMatch(logged.join(' '),/private raw details/);
 }finally{console.warn=oldWarn;}
});

test('only structural metadata and safe provider codes are logged',()=>{
 const raw={message:'test_payer_private@example.com',error:'bad_request',cause:[
    {code:'PA_INVALID_USER',description:'Private details: APP_USR-secret'},
    {code:'test_user_123456789',description:'private'}
 ]};
 assert.deepEqual(safePreapprovalErrorMetadata(raw),
 {response_shape:'error_message_cause',provider_code:'bad_request'});
 const serialized=JSON.stringify(safePreapprovalErrorMetadata(raw));
 assert.doesNotMatch(serialized,/test_payer|APP_USR-secret|test_user/);
});
test('rejects malformed or sensitive-looking provider codes',()=>{
 assert.equal(safePreapprovalErrorMetadata({code:'APP_USR-private'}).provider_code,'unavailable');
 assert.equal(safePreapprovalErrorMetadata({code:'1234567890123'}).provider_code,'unavailable');
 assert.equal(safePreapprovalErrorMetadata({code:'payer@customer.test'}).provider_code,'unavailable');
 assert.equal(safePreapprovalErrorMetadata({code:123456}).provider_code,'unavailable');
 assert.equal(safePreapprovalErrorMetadata(null).response_shape,'non_object');
});
