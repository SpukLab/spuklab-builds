import test from 'node:test';
import assert from 'node:assert/strict';
import {decideTestCheckoutRecovery as decide} from './mercadopago-test-recovery.mjs';
const intent={stage:'prepared',live_mode:false,external_reference:'cithela_1234567890123456',collector_id:'1234',amount_minor:1500000};
const match={id:'sub123',external_reference:intent.external_reference,collector_id:'1234',
 live_mode:false,auto_recurring:{currency_id:'ARS',transaction_amount:15000}};
test('network ambiguity never authorizes a second POST',()=>{
 for(const input of [{},{lookupComplete:false,providerSnapshots:[match]},
  {lookupComplete:true,providerSnapshots:[]},
  {lookupComplete:true,providerSnapshots:[match,match]}]){
  const result=decide({intent,...input});
  assert.equal(result.may_create,false);
  assert.equal(result.ok,false);
 }
});
test('verified matching preapproval can be linked but never grants access',()=>{
 const result=decide({intent,providerSnapshots:[match],lookupComplete:true});
 assert.equal(result.ok,true);
 assert.equal(result.provider_subscription_id,'sub123');
 assert.equal(result.payment_verified,false);
 assert.equal(result.entitlement_activation_allowed,false);
 assert.equal(result.may_create,false);
});
test('rejects incorrect seller, amount, currency, mode or reference',()=>{
 const wrong=[
  {...match,collector_id:'999'},
  {...match,live_mode:true},
  {...match,external_reference:'other'},
  {...match,auto_recurring:{currency_id:'USD',transaction_amount:15000}},
  {...match,auto_recurring:{currency_id:'ARS',transaction_amount:15001}}
 ];
 for(const candidate of wrong){
  const result=decide({intent,providerSnapshots:[candidate],lookupComplete:true});
  assert.equal(result.ok,false);
  assert.equal(result.may_create,false);
 }
});
