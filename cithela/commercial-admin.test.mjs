import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {handleCithelaCommercialAdmin} from './commercial/commercial-admin-handler.mjs';

const admin='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
const req=(action='read',payload={},headers={})=>new Request(
 'https://example.supabase.co/functions/v1/cithela-commercial-admin',{
 method:'POST',
 headers:{
  origin:'https://spuklab.github.io',
  authorization:'Bearer verified-session',
  'content-type':'application/json',
  ...headers
 },
 body:JSON.stringify({action,payload})
});
function options(extra={}){
 const commands=[];
 return {
  commands,
  settings:{
   enabled:true,adminId:admin,
   resolveUser:async()=>({id:admin,emailConfirmed:true}),
   execute:async(actor,action,payload)=>{
    commands.push({actor,action,payload});
    return {ok:true,code:'snapshot',prices:[],tenants:[],candidates:[]};
   },
   ...extra
  }
 };
}
const parse=async r=>({status:r.status,...await r.json()});
test('verified platform administrator can view draft options through server-only command',async()=>{
 const {settings,commands}=options();
 const response=await parse(await handleCithelaCommercialAdmin(req(),settings));
 assert.equal(response.status,200);
 assert.equal(response.ok,true);
 assert.deepEqual(commands,[{actor:admin,action:'read',payload:{}}]);
});
test('console fails closed until platform admin UUID and enable flag are configured',async()=>{
 for(const extra of [{enabled:false},{adminId:''},{adminId:'bad-uuid'}]){
  const {settings,commands}=options(extra);
  const res=await parse(await handleCithelaCommercialAdmin(req(),settings));
  assert.equal(res.status,503);
  assert.equal(res.code,'console_not_enabled');
  assert.equal(commands.length,0);
 }
});
test('no arbitrary browser or different logged in professional can access administration',async()=>{
 const {settings,commands}=options();
 const wrong=await parse(await handleCithelaCommercialAdmin(
  req('read',{}, {origin:'https://attacker.example'}),settings));
 assert.equal(wrong.status,403);
 const guest=await parse(await handleCithelaCommercialAdmin(
  req('read',{}, {authorization:''}),settings));
 assert.equal(guest.status,401);
 const someone=await parse(await handleCithelaCommercialAdmin(req(),
  options({resolveUser:async()=>({id:other,emailConfirmed:true})}).settings));
 assert.equal(someone.status,403);
 const unverified=await parse(await handleCithelaCommercialAdmin(req(),
  options({resolveUser:async()=>({id:admin,emailConfirmed:false})}).settings));
 assert.equal(unverified.status,403);
 assert.equal(commands.length,0);
});
test('only price, grant and retention commands; no billing, purge or privilege actions',async()=>{
 for(const action of ['delete','purge','charge','publish','create_subscription','grant_admin']){
  const {settings,commands}=options();
  const res=await parse(await handleCithelaCommercialAdmin(req(action,{}),settings));
  assert.equal(res.status,400);
  assert.equal(commands.length,0);
 }
 const {settings,commands}=options();
 const forged=await parse(await handleCithelaCommercialAdmin(
  req('choose_price',{price_id:other,amount_minor:1,force:true}),settings));
 assert.equal(forged.status,400);
 assert.equal(commands.length,0);
});
test('SQL keeps all commercial resources private and only accepts server command RPC',()=>{
 const schema=readFileSync(new URL('./supabase/commercial-controls-price-free-retention-20261104.sql',import.meta.url),'utf8');
 const controls=readFileSync(new URL('./supabase/commercial-admin-command-20261104.sql',import.meta.url),'utf8');
 for(const table of ['cithela_price_options','cithela_complimentary_grants',
  'cithela_retention_holds','cithela_retention_settings']){
   assert.match(schema,new RegExp('ALTER TABLE cithela_private\\.'+table+' ENABLE ROW LEVEL SECURITY'));
   assert.match(schema,new RegExp('REVOKE ALL ON cithela_private\\.'+table));
 }
 assert.match(schema,/is_published boolean NOT NULL DEFAULT false[\s\S]*?CHECK \(is_published=false\)/);
 assert.match(schema,/automatic_purge boolean NOT NULL DEFAULT false CHECK\(automatic_purge=false\)/);
 assert.match(schema,/cithela_one_unrevoked_complimentary_grant/);
 assert.match(controls,/REVOKE ALL ON FUNCTION public\.cithela_commercial_admin_command/);
 assert.match(controls,/FROM PUBLIC,anon,authenticated/);
 assert.match(controls,/TO service_role/);
 assert.match(controls,/cithela_commercial_admin_audit/);
 assert.match(controls,/p_action='choose_price'/);
 assert.match(controls,/p_action='grant_free'/);
 assert.match(controls,/p_action IN \('grant_free','revoke_free'\)/);
 assert.match(controls,/p_action='set_retention'/);
 assert.doesNotMatch(schema+'\n'+controls,/DELETE\s+FROM\s+(?:public|cithela_private)\./i);
 assert.doesNotMatch(controls,/UPDATE\s+cithela_private\.cithela_commercial_entitlements/i);
});
test('commercial entitlement uses complementary override while preserving owner status authorization',()=>{
 const schema=readFileSync(new URL('./supabase/commercial-controls-price-free-retention-20261104.sql',import.meta.url),'utf8');
 const app=readFileSync(new URL('./index.html',import.meta.url),'utf8');
 assert.match(schema,/s:='complimentary'/);
 assert.match(schema,/y\.revoked_at IS NULL AND y\.starts_at<=p_check_at/);
 assert.match(schema,/e\.status IN[\s\S]*?\('trialing','payment_pending','past_due','canceled'\)/);
 assert.match(schema,/m\.user_id=actor AND m\.tenant_id=p_tenant_id/);
 assert.match(schema,/m\.role IN \('owner','admin'\)/);
 assert.match(app,/complimentary:\['Acceso de cortesía'/);
 assert.match(app,/c\.complimentary_until/);
});
test('admin frontend is an optional restricted tool and does not expose credentials',()=>{
 const html=readFileSync(new URL('./comercial-admin.html',import.meta.url),'utf8');
 const edge=readFileSync(new URL('./edge/cithela-commercial-admin/index.ts',import.meta.url),'utf8');
 assert.match(html,/id="price-select"/);
 assert.match(html,/id="grant-free"/);
 assert.match(html,/id="retention-list"/);
 assert.match(html,/noindex,nofollow/);
 assert.match(html,/\.replaceChildren\(/);
 assert.match(html,/\.textContent=/);
 assert.doesNotMatch(html,/\.innerHTML\s*=|pilotTenant=1|DELETE FROM|payment_created:true|CITHELA_MP_TEST_ACCESS_TOKEN/);
 assert.match(edge,/CITHELA_COMMERCIAL_ADMIN_USER_ID/);
 assert.match(edge,/CITHELA_COMMERCIAL_CONSOLE_ENABLED/);
 assert.match(edge,/verify JWT|auth\.getUser\(jwt\)/);
 assert.doesNotMatch(edge,/api\.mercadopago\.com|service_role\s*:/i);
});

test('admin console disables actions for protected pilots and confirms every write',()=>{
 const html=readFileSync(new URL('./comercial-admin.html',import.meta.url),'utf8');
 assert.match(html,/function syncGrantButtons\(\)/);
 assert.match(html,/\['trialing','payment_pending','past_due','canceled'\]\.includes\(tenant\.status\)/);
 assert.match(html,/\$\('tenant-select'\)\.addEventListener\('change',syncGrantButtons\)/);
 assert.match(html,/\$\('grant-free'\)\.disabled=!eligible/);
 assert.match(html,/\$\('revoke-free'\)\.disabled=!tenant\?\.has_unrevoked_grant/);
 assert.match(html,/¿Agregar la tarifa borrador/);
 assert.match(html,/¿Guardar estos plazos de revisión\?/);
 assert.match(html,/¿Seleccionar este precio/);
 assert.match(html,/¿Otorgar acceso sin cargo/);
 assert.match(html,/¿Revocar la cortesía/);
});
