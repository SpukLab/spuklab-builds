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
test('Edge function allows only verified global SpukLab admin before reading the credential',()=>{
 const edge=readFileSync(new URL('./edge/cithela-mp-test-connection/index.ts',import.meta.url),'utf8');
 const matchConfig=edge.indexOf('CITHELA_COMMERCIAL_CONSOLE_ENABLED');
 const matchAdminId=edge.indexOf('CITHELA_COMMERCIAL_ADMIN_USER_ID');
 const matchAuth=edge.indexOf('admin.auth.getUser(bearer)');
 const matchAdmin=edge.indexOf('user.id.toLowerCase()!==adminId.toLowerCase()');
 const matchToken=edge.indexOf('Deno.env.get("CITHELA_MP_TEST_ACCESS_TOKEN")');
 assert.ok(matchConfig>0&&matchAdminId>0&&matchAdminId<matchAuth&&
  matchAuth<matchAdmin&&matchAdmin<matchToken,'authorization must precede credential read');
 assert.match(edge,/if\(!url\|\|!key\|\|!enabled\|\|!UUID.test\(adminId\)\)/);
 assert.match(edge,/!user.email_confirmed_at/);
 assert.match(edge,/return respond\("forbidden",403\)/);
 assert.doesNotMatch(edge,/cithela_tenant_memberships|\.in\("role",\["owner","admin"\]\)/);
 assert.match(edge,/req.method!=="POST"/);
 assert.match(edge,/invalid_origin/);
 assert.doesNotMatch(edge,/\.update\(|\.insert\(|\.delete\(|preapproval\/create/i);
 assert.doesNotMatch(edge,/console\.(?:log|warn|error)|JSON\.stringify\(.*testToken|return.*testToken/);
});

test('MP diagnostics live only in platform commercial center, not tenant Settings',()=>{
 const tenant=readFileSync(new URL('./index.html',import.meta.url),'utf8');
 const center=readFileSync(new URL('./comercial-admin.html',import.meta.url),'utf8');
 assert.doesNotMatch(tenant,/mpTest|cithela-mp-test-tools|checkCithelaMpTestConnection/);
 assert.doesNotMatch(tenant,/Comprobar Mercado Pago de prueba/);
 assert.match(tenant,/id="cithela-commercial-panel"/);
 assert.match(tenant,/id="cithela-commercial-status"/);
 assert.match(center,/id="mp-test-check"/);
 assert.match(center,/id="mp-test-status"/);
 assert.match(center,/functions.invoke\('cithela-mp-test-connection'/);
 assert.match(center,/id="console" hidden/);
 assert.doesNotMatch(center,/CITHELA_MP_TEST_ACCESS_TOKEN|APP_USR-/);
});
