import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {handlePilotShareLinks} from './commercial/pilot-share-links-handler.mjs';

const admin='11111111-1111-4111-8111-111111111111';
const guest='22222222-2222-4222-8222-222222222222';
const token='a'.repeat(64),hash='f'.repeat(64);
function request(action,payload={},headers={},method='POST'){
 return new Request('https://example.supabase.co/functions/v1/cithela-pilot-share-links',{
  method,headers:{origin:'https://spuklab.github.io',
    authorization:'Bearer test-token',...headers},
  body:method==='GET'?undefined:JSON.stringify({action,payload})
 });
}
function context(id=admin){
 const calls=[];
 return {calls,
  enabled:true,adminId:admin,
  resolveUser:async()=>({id,emailConfirmed:true}),
  generateToken:()=>token,digestToken:async()=>hash,
  execute:async(user,action,payload)=>{
   calls.push({user,action,payload});
   if(action==='issue')return {ok:true,code:'link_created',
     link_id:guest,max_uses:payload.max_uses,expires_at:'2026-11-17T15:00:00Z'};
   if(action==='list')return {ok:true,code:'links_listed',links:[]};
   if(action==='revoke')return {ok:true,code:'link_revoked'};
   return {ok:true,code:'grant_ready'};
  }
 };
}
const read=async r=>({status:r.status,...await r.json()});

test('admin issues one limited link; server receives hash, never original token',async()=>{
 const ctx=context();
 const r=await read(await handlePilotShareLinks(request('issue',{maxUses:2}),ctx));
 assert.equal(r.status,200);
 assert.equal(r.code,'link_created');
 assert.equal(r.max_uses,2);
 assert.equal(r.share_url,
  'https://spuklab.github.io/spuklab-builds/cithela/alta-whatsapp.html#invitacion='+token);
 assert.deepEqual(ctx.calls,[{user:admin,action:'issue',
  payload:{token_hash:hash,max_uses:2}}]);
});
test('only admin can issue, list and revoke; professional can redeem a verified token',async()=>{
 const ctx=context(guest);
 for(const [action,payload] of [['issue',{maxUses:2}],['list',{}],
   ['revoke',{linkId:guest}]]){
  assert.equal((await read(await handlePilotShareLinks(request(action,payload),ctx))).status,403);
 }
 assert.equal(ctx.calls.length,0);
 const r=await read(await handlePilotShareLinks(request('redeem',{token}),ctx));
 assert.equal(r.status,200);assert.equal(r.code,'grant_ready');
 assert.deepEqual(ctx.calls,[{user:guest,action:'redeem',payload:{token_hash:hash}}]);
});
test('all operations reject wrong origin, no JWT, bad session, disabled flag',async()=>{
 const ctx=context();
 assert.equal((await read(await handlePilotShareLinks(
   request('list',{}, {origin:'https://evil.test'}),ctx))).status,403);
 assert.equal((await read(await handlePilotShareLinks(
   request('list',{}, {authorization:''}),ctx))).status,401);
 assert.equal((await read(await handlePilotShareLinks(
   request('list'),{...ctx,enabled:false}))).status,503);
 assert.equal((await read(await handlePilotShareLinks(
   request('list'),{...ctx,resolveUser:async()=>({id:guest,emailConfirmed:false})}))).status,403);
 assert.equal((await read(await handlePilotShareLinks(
   request('list'),{...ctx,resolveUser:async()=>{throw Error('auth')}}))).status,503);
});
test('browser cannot forge identity, unlimited uses, expiry, admin access or billing',async()=>{
 const ctx=context();
 for(const [action,payload] of [
  ['issue',{maxUses:10}],['issue',{maxUses:0}],['issue',{maxUses:2,days:300}],
  ['redeem',{token,userId:admin}],['redeem',{token:'not-a-valid-token'}],
  ['list',{all:true}],['revoke',{linkId:'abc'}],
  ['delete',{}]
 ]){
   assert.equal((await read(await handlePilotShareLinks(request(action,payload),ctx))).status,400);
 }
 assert.equal(ctx.calls.length,0);
});
test('quota, revoked and previously trialled errors never create a grant on client',async()=>{
 for(const [code,expected] of [
  ['daily_limit',429],['link_exhausted',429],
  ['link_unavailable',404],['trial_already_used',403]
 ]){
  const ctx={...context(guest),execute:async()=>({ok:false,code})};
  const r=await read(await handlePilotShareLinks(request('redeem',{token}),ctx));
  assert.equal(r.status,expected);assert.equal(r.ok,false);
 }
});
test('database remains private and slots are atomic and one per verified user',()=>{
 const sql=readFileSync(new URL('./supabase/pilot-whatsapp-share-links-20261110.sql',import.meta.url),'utf8');
 assert.match(sql,/REVOKE ALL ON cithela_private\.cithela_pilot_share_links/);
 assert.match(sql,/REVOKE ALL ON cithela_private\.cithela_pilot_share_uses/);
 assert.match(sql,/REVOKE ALL ON FUNCTION public\.cithela_pilot_share_link_command/);
 assert.match(sql,/TO service_role/);
 assert.match(sql,/auth\.users u WHERE u\.id=p_actor FOR UPDATE/);
 assert.match(sql,/pg_advisory_xact_lock/);
 assert.match(sql,/v_uses>=v_link\.max_uses/);
 assert.match(sql,/user_id uuid NOT NULL UNIQUE/);
 assert.match(sql,/cithela_onboarding_grants/);
 assert.match(sql,/email_confirmed_at/);
 assert.doesNotMatch(sql,/UPDATE\s+cithela_private\.cithela_commercial_entitlements/i);
 assert.doesNotMatch(sql,/DROP\s+TABLE|TRUNCATE|DELETE FROM public\.cithela_tenants/i);
});
test('WhatsApp signup reuses verified email and server grant, never authorizes URL param alone',()=>{
 const signup=readFileSync(new URL('./alta-whatsapp.html',import.meta.url),'utf8');
 const adminPage=readFileSync(new URL('./invitar-profesionales.html',import.meta.url),'utf8');
 const adminJs=readFileSync(new URL('./commercial/pilot-share-admin.js',import.meta.url),'utf8');
 const edge=readFileSync(new URL('./edge/cithela-pilot-share-links/index.ts',import.meta.url),'utf8');
 const inline=signup.match(/<script>([\s\S]*?)<\/script>/)?.[1];
 assert.ok(inline);assert.doesNotThrow(()=>new Function(inline));
 assert.doesNotThrow(()=>new Function(adminJs));
 assert.match(signup,/auth\.signUp/);
 assert.match(signup,/email_confirmed_at/);
 assert.match(signup,/cithela-pilot-share-links/);
 assert.match(signup,/action:'redeem'/);
 assert.match(signup,/pilotTenant=1/);
 assert.match(adminPage,/pilot-share-admin\.js/);
 assert.match(adminJs,/https:\/\/wa\.me\/\?text=/);
 assert.match(edge,/CITHELA_PILOT_SHARE_LINKS_ENABLED/);
 assert.match(edge,/CITHELA_COMMERCIAL_ADMIN_USER_ID/);
 assert.match(edge,/auth\.getUser\(jwt\)/);
 assert.doesNotMatch(signup+adminPage+adminJs,/SUPABASE_SERVICE_ROLE_KEY|CITHELA_MP_TEST_ACCESS_TOKEN/);
});
