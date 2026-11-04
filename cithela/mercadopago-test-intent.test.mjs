import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {handleCithelaMpTestIntent} from './payments/mercadopago-test-intent-handler.mjs';

const tenant='11111111-1111-4111-8111-111111111111';
const owner='22222222-2222-4222-8222-222222222222';
const intentId='33333333-3333-4333-8333-333333333333';
const nonce='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const body={tenantId:tenant,termsVersion:'internal-test-only-v1',consent:true};
const req=(data=body,headers={},method='POST')=>new Request('https://supabase.example/functions/v1/cithela-mp-test-intent',{
 method,headers:{origin:'https://spuklab.github.io',authorization:'Bearer test-user-jwt',
  'content-type':'application/json',...headers},...(method==='POST'?{body:JSON.stringify(data)}:{})
});
function cfg(overrides={}){
 const seen=[];
 const settings={
  enabled:true,merchantUserId:'123456789',amountMinor:1500000,
  randomUUID:()=>nonce,
  resolveActor:async()=>({id:owner,emailConfirmed:true}),
  prepareIntent:async(x)=>{seen.push(x);return {
   ok:true,code:'prepared',intent_id:intentId,external_reference:x.externalReference
  }},
  ...overrides
 };
 return {settings,seen};
}
const parse=async r=>({status:r.status,...await r.json()});

test('explicit test consent produces one owner-authorized intent without provider API calls',async()=>{
 const {settings,seen}=cfg();
 const response=await parse(await handleCithelaMpTestIntent(req(),settings));
 assert.equal(response.status,200);
 assert.equal(response.code,'prepared');
 assert.equal(response.test_only,true);
 assert.equal(response.payment_created,false);
 assert.equal(seen.length,1);
 assert.deepEqual(seen[0],{
  tenantId:tenant,ownerUserId:owner,
  externalReference:'cithela_'+nonce.replaceAll('-',''),
  collectorId:'123456789',amountMinor:1500000,termsVersion:'internal-test-only-v1'
 });
});
test('blocked until feature, amount and seller are explicitly configured',async()=>{
 for(const overrides of [{enabled:false},{amountMinor:NaN},{amountMinor:0},
  {merchantUserId:''},{merchantUserId:'untrusted'},{amountMinor:100000000001}]){
  const {settings,seen}=cfg(overrides);
  const result=await parse(await handleCithelaMpTestIntent(req(),settings));
  assert.equal(result.status,503);
  assert.equal(seen.length,0);
 }
});
test('no implicit consent; malformed tenants, extra price and substitute terms are rejected',async()=>{
 const inputs=[
  {...body,consent:false},{...body,consent:'true'},
  {...body,termsVersion:'real-contract-v1'},
  {...body,tenantId:'another-tenant'},
  {...body,amountMinor:100},
  {...body,collectorId:'55555'},
  {...body,ownerUserId:owner}
 ];
 for(const input of inputs){
  const {settings,seen}=cfg();
  const res=await parse(await handleCithelaMpTestIntent(req(input),settings));
  assert.equal(res.status,400,JSON.stringify(input));
  assert.equal(seen.length,0);
 }
});
test('cross-origin requests and unauthenticated or unverified users are rejected',async()=>{
 let i=0;
 const badOrigin=await parse(await handleCithelaMpTestIntent(req(body,{origin:'https://evil.example'}),cfg().settings));
 assert.equal(badOrigin.status,403);
 const noJwt=await parse(await handleCithelaMpTestIntent(req(body,{authorization:''}),cfg().settings));
 assert.equal(noJwt.status,401);
 const unverified=cfg({resolveActor:async()=>({id:owner,emailConfirmed:false}),
  prepareIntent:async()=>{i++;throw Error('should not write')}});
 assert.equal((await parse(await handleCithelaMpTestIntent(req(),unverified.settings))).status,403);
 assert.equal(i,0);
});
test('legacy and cross-tenant denial from SQL is not converted into creation',async()=>{
 for(const [code,http] of [['not_eligible',403],
  ['existing_intent_conflict',409],['already_in_progress',409]]){
  const {settings}=cfg({prepareIntent:async()=>({ok:false,code})});
  const r=await parse(await handleCithelaMpTestIntent(req(),settings));
  assert.equal(r.status,http);
  assert.equal(r.ok,false);
 }
});
test('repeat submissions can return the existing intent, preserving a single tenant binding',async()=>{
 const {settings}=cfg({prepareIntent:async x=>({
  ok:true,code:'already_prepared',intent_id:intentId,
  external_reference:x.externalReference
 })});
 const res=await parse(await handleCithelaMpTestIntent(req(),settings));
 assert.equal(res.code,'already_prepared');
 assert.equal(res.payment_created,false);
});
test('backend exception hides sensitive content and does not claim success',async()=>{
 const {settings}=cfg({prepareIntent:async()=>{throw Error('secret token:MP_ACCESS_TOKEN')}});
 const response=await parse(await handleCithelaMpTestIntent(req(),settings));
 assert.equal(response.status,503);
 assert.doesNotMatch(JSON.stringify(response),/secret|MP_ACCESS_TOKEN/);
});
test('SQL server-only RPC cannot be called from browsers and does not create a payment',()=>{
 const sql=readFileSync(new URL('./supabase/mercadopago-authorized-test-intent-20261103.sql',import.meta.url),'utf8');
 const edge=readFileSync(new URL('./edge/cithela-mp-test-intent/index.ts',import.meta.url),'utf8');
 assert.match(sql,/REVOKE ALL ON FUNCTION public\.cithela_mp_prepare_test_intent\(/);
 assert.match(sql,/FROM PUBLIC,anon,authenticated/);
 assert.match(sql,/TO service_role/);
 assert.match(sql,/m\.role='owner' AND u\.email_confirmed_at IS NOT NULL/);
 assert.match(sql,/e\.status IN \('trialing','payment_pending','past_due'\)/);
 assert.match(sql,/p_terms_version IS DISTINCT FROM 'internal-test-only-v1'/);
 assert.match(sql,/FOR UPDATE OF e/);
 assert.match(edge,/CITHELA_MP_TEST_INTENT_ENABLED/);
 assert.match(edge,/CITHELA_MP_TEST_AMOUNT_MINOR/);
 assert.match(edge,/admin\.auth\.getUser\(token\)/);
 assert.match(edge,/cithela_mp_prepare_test_intent/);
 assert.doesNotMatch(sql,/UPDATE\s+cithela_private\.cithela_commercial_entitlements/i);
 assert.doesNotMatch(edge,/api\.mercadopago\.com|preapproval\/|checkout\/|fetch\(/i);
});
