import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {checkMercadoPagoTestConnection} from './edge/cithela-mp-test-connection/connection.mjs';

const token='APP_USR-fake-testing-credential-1234567890';
test('read-only GET can confirm test API access without exposing provider records',async()=>{
  let called=0;
  const fetchImpl=async(url,options)=>{
    called++;
    assert.equal(url,'https://api.mercadopago.com/preapproval/search');
    assert.equal(options.method,'GET');
    assert.equal(options.headers.Authorization,'Bearer '+token);
    return Response.json({paging:{total:1},results:[{payer_email:'private@example.test',access_token:'never_expose'}]});
  };
  const result=await checkMercadoPagoTestConnection(token,fetchImpl);
  assert.deepEqual(result,{ok:true,code:'test_api_connected'});
  assert.equal(called,1);
  assert.doesNotMatch(JSON.stringify(result),/private@|access_token|APP_USR/);
});
test('unauthorized or malformed token does not masquerade as connectivity',async()=>{
  for(const [status,code] of [[401,'credential_rejected'],[403,'subscription_permission_denied'],
    [429,'provider_rate_limited'],[500,'provider_unavailable']]){
    assert.deepEqual(await checkMercadoPagoTestConnection(token,async()=>new Response('{}',{status})),
      {ok:false,code});
  }
  let called=false;
  assert.deepEqual(await checkMercadoPagoTestConnection('',async()=>{called=true}),
    {ok:false,code:'test_token_missing_or_invalid_format'});
  assert.equal(called,false);
});
test('provider success requires well-formed pagination, not just HTTP 200',async()=>{
  const r=await checkMercadoPagoTestConnection(token,async()=>Response.json({user:'fake'}));
  assert.deepEqual(r,{ok:false,code:'unexpected_provider_response'});
});
test('connection and timeout errors hide details and secrets',async()=>{
  const r=await checkMercadoPagoTestConnection(token,async()=>{throw Error('TOKEN '+token)});
  assert.deepEqual(r,{ok:false,code:'provider_unavailable'});
  assert.doesNotMatch(JSON.stringify(r),/TOKEN|APP_USR/);
});
test('Edge function requires auth user and owner/admin membership before reading secret',()=>{
  const edge=readFileSync(new URL('./edge/cithela-mp-test-connection/index.ts',import.meta.url),'utf8');
  const matchAuth=edge.indexOf('admin.auth.getUser(bearer)');
  const matchMembership=edge.indexOf('.in("role",["owner","admin"])');
  const matchEnv=edge.indexOf('Deno.env.get("CITHELA_MP_TEST_ACCESS_TOKEN")');
  assert.ok(matchAuth>0&&matchMembership>matchAuth&&matchEnv>matchMembership);
  assert.match(edge,/if\(!membership\?\.length\)return respond\("forbidden",403\)/);
  assert.match(edge,/req\.method!=="POST"/);
  assert.match(edge,/invalid_origin/);
  assert.doesNotMatch(edge,/\.update\(|\.insert\(|\.delete\(|preapproval\/create/i);
  assert.doesNotMatch(edge,/console\.(?:log|warn|error)|JSON\.stringify\(.*testToken|return.*testToken/);
});
