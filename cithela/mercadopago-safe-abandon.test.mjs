import test from 'node:test';
import assert from 'node:assert/strict';
import {assessProviderAbsence} from '../payments/mercadopago-safe-abandon.mjs';
const reference='cithela_abcdefghijklmnop';
const empty=()=>({complete:true,items:[]});
test('three complete searches without matches permit only audit reconciliation',()=>{
 assert.deepEqual(assessProviderAbsence({reference,email:empty(),id:empty(),seller:empty()}),
   {ok:true,code:'verified_absent_for_reconciliation'});
});
test('any incomplete provider query fails closed',()=>{
 for(const key of ['email','id','seller']){
   const queries={reference,email:empty(),id:empty(),seller:empty()};
   queries[key]={complete:false,items:[]};
   assert.equal(assessProviderAbsence(queries).ok,false);
 }
});
test('matches in each independent scope prevent abandonment',()=>{
 for(const key of ['email','id','seller']){
   const queries={reference,email:empty(),id:empty(),seller:empty()};
   queries[key]={complete:true,items:[{external_reference:reference,id:'123'}]};
   assert.equal(assessProviderAbsence(queries).code,'provider_subscription_found_requires_link');
 }
});
test('unrelated subscriptions do not block an absent reference',()=>{
 assert.equal(assessProviderAbsence({reference,email:{complete:true,items:[{external_reference:'different'}]},id:empty(),seller:empty()}).ok,true);
});
test('invalid reference and missing proof fail closed',()=>{
 assert.equal(assessProviderAbsence({reference:'',email:empty(),id:empty(),seller:empty()}).ok,false);
 assert.equal(assessProviderAbsence({reference,email:empty(),seller:empty()}).code,'provider_lookup_incomplete');
});
