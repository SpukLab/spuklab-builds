import test from 'node:test';
import assert from 'node:assert/strict';
import {checkProductionReadiness} from './mercadopago-production-readiness.mjs';
const cfg={token:'APP_USR-abcdefghijklmnop',secret:'different-secret-1234',merchant:'90000001',testToken:'APP_USR-qrstuvwxyzabcdef',testSecret:'old-secret-1234567'};
test('real seller config can be checked without claiming application, webhook or payment readiness',async()=>{
 const r=await checkProductionReadiness(cfg,async()=>({id:90000001,site_id:'MLA',tags:['normal']}));
 assert.equal(r.configurationReady,true);
 for(const k of ['applicationVerified','webhookVerified','checkoutEnabled','chargeCreated'])assert.equal(r[k],false);
 assert.equal(JSON.stringify(r).includes(cfg.token),false);
 assert.equal(JSON.stringify(r).includes(cfg.secret),false);
});
test('test credentials, test seller and wrong seller fail closed',async()=>{
 for(const c of [{...cfg,token:cfg.testToken},{...cfg,secret:cfg.testSecret},{...cfg,merchant:'3813812326'}]){
  const r=await checkProductionReadiness(c,async()=>({id:90000001,site_id:'MLA',tags:['normal']}));
  assert.equal(r.configurationReady,false);
 }
 for(const seller of [{id:90000001,site_id:'MLA',tags:['test_user']},{id:90000002,site_id:'MLA',tags:[]},null]){
  assert.equal((await checkProductionReadiness(cfg,async()=>seller)).configurationReady,false);
 }
});
test('missing config avoids provider access, network errors never authorize a checkout',async()=>{
 let calls=0;
 assert.equal((await checkProductionReadiness({},async()=>{calls++;})).configurationReady,false);
 assert.equal(calls,0);
 assert.equal((await checkProductionReadiness(cfg,async()=>{throw Error('network')})).configurationReady,false);
});
