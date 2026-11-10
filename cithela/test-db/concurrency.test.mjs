import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import EmbeddedPostgres from 'embedded-postgres';
const source=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const a='11111111-1111-4111-8111-111111111111',u='22222222-2222-4222-8222-222222222222',v='33333333-3333-4333-8333-333333333333',w='44444444-4444-4444-8444-444444444444';
const fixture=`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
CREATE SCHEMA auth;CREATE SCHEMA cithela_private;
CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE SQL AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
CREATE TABLE public.cithela_tenants(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),display_name text,timezone text,status text DEFAULT 'active',created_at timestamptz DEFAULT now());
CREATE TABLE public.cithela_tenant_memberships(tenant_id uuid,user_id uuid,role text,created_at timestamptz DEFAULT now(),PRIMARY KEY(tenant_id,user_id));
CREATE TABLE public.cithela_services(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,name text,duration_min integer);
CREATE TABLE public.cithela_resources(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,name text);
CREATE TABLE public.cithela_operational_events(tenant_id uuid,actor_user_id uuid,event_type text,entity_type text,entity_id uuid,payload jsonb);
CREATE TABLE public.cithela_appointments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,status text,starts_at timestamptz,ends_at timestamptz,person_id uuid,resource_id uuid,service_id uuid,duration_min integer);
INSERT INTO auth.users VALUES('${a}','admin@invalid.example',now()),('${u}','one@invalid.example',now()),('${v}','two@invalid.example',now()),('${w}','three@invalid.example',now());`;
test('PostgreSQL 17: concurrent capacity, retries, bootstrap rollback, expiry and reservation preservation', {timeout:60000},async t=>{
 const dir=mkdtempSync(join(tmpdir(),'cithela-pg-'));const db=new EmbeddedPostgres({databaseDir:join(dir,'db'),port:55439,user:'postgres',password:'local-test-only',persistent:false,autoRehydrateSymlinks:true,postgresFlags:['-c','unix_socket_directories='],onLog:()=>{},onError:()=>{}});
 const keepalive=setInterval(()=>{},1000);let c1,c2;
 try{
  await db.initialise();await db.start();c1=db.getPgClient();c2=db.getPgClient();await c1.connect();await c2.connect();
  await c1.query(fixture);
  await c1.query(source('supabase/commercial-onboarding-activation-20261102.sql').split('CREATE OR REPLACE FUNCTION')[0]);
  await c1.query(source('supabase/commercial-booking-enforcement-20261102.sql').split('-- Patched source function: channel_availability_core')[0]);
  await c1.query(source('supabase/pilot-invitation-table-20261106.sql'));
  await c1.query(source('supabase/pilot-invitation-command-20261106.sql'));
  await c1.query(source('sql-review/selfservice-admission-20261110.sql'));
  const cmd=async(c,id,action,payload={})=>(await c.query('SELECT public.cithela_selfservice_command($1,$2,$3,$4) out',[id,a,action,payload])).rows[0].out;
  assert.equal((await cmd(c1,null,'status')).code,'admissions_closed');
  await cmd(c1,a,'configure',{enabled:true,daily_limit:20,active_limit:1,invitation_hours:24});
  const result=await Promise.all([cmd(c1,u,'admit',{terms_version:'selfservice-trial-20261110'}),cmd(c2,v,'admit',{terms_version:'selfservice-trial-20261110'})]);
  assert.deepEqual(result.map(r=>r.code).sort(),['capacity_reached','grant_ready']);const winner=result[0].ok?u:v,loser=winner===u?v:u;
  await t.test('last slot is reserved once across separate connections',async()=>{assert.equal((await c1.query('SELECT count(*)::int n FROM cithela_private.cithela_selfservice_admissions')).rows[0].n,1);assert.equal((await c1.query('SELECT count(*)::int n FROM cithela_private.cithela_onboarding_grants')).rows[0].n,1)});
  await t.test('same-user simultaneous retry never extends or duplicates the invitation',async()=>{const before=(await c1.query('SELECT expires_at FROM cithela_private.cithela_onboarding_grants WHERE user_id=$1',[winner])).rows[0].expires_at;const results=await Promise.all([cmd(c1,winner,'admit',{terms_version:'selfservice-trial-20261110'}),cmd(c2,winner,'admit',{terms_version:'selfservice-trial-20261110'})]);assert.ok(results.every(r=>r.code==='grant_ready'));assert.equal(String((await c1.query('SELECT expires_at FROM cithela_private.cithela_onboarding_grants WHERE user_id=$1',[winner])).rows[0].expires_at),String(before))});
  await t.test('paused admissions do not prevent resuming an existing authorization',async()=>{await cmd(c1,a,'configure',{enabled:false,daily_limit:20,active_limit:1,invitation_hours:24});assert.equal((await cmd(c1,winner,'resume')).code,'grant_ready');assert.equal((await cmd(c1,loser,'admit',{terms_version:'selfservice-trial-20261110'})).code,'admissions_closed')});
  await t.test('rollback restores the grant without leaving a partial establishment',async()=>{await c1.query('BEGIN');await c1.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[winner]);assert.equal((await c1.query("SELECT cithela_private.bootstrap_tenant('Disposable rollback') out")).rows[0].out.code,'workspace_created');await c1.query('ROLLBACK');assert.equal((await c1.query('SELECT count(*)::int n FROM public.cithela_tenants')).rows[0].n,0);assert.equal((await cmd(c1,winner,'resume')).code,'grant_ready')});
  let tenant;
  await t.test('concurrent bootstrap creates one agenda and one exact seven-day entitlement',async()=>{
   await c1.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[winner]);await c2.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[winner]);
   const results=await Promise.all([c1.query("SELECT cithela_private.bootstrap_tenant('Workspace A') out"),c2.query("SELECT cithela_private.bootstrap_tenant('Workspace A') out")]);assert.deepEqual(results.map(r=>r.rows[0].out.code).sort(),['workspace_created','workspace_exists']);tenant=results[0].rows[0].out.tenant.id;
   const ent=(await c1.query("SELECT count(*)::int n,bool_and(trial_ends_at=trial_started_at+interval '7 days') duration FROM cithela_private.cithela_commercial_entitlements")).rows[0];assert.equal(ent.n,1);assert.equal(ent.duration,true);assert.equal((await cmd(c1,winner,'resume')).code,'workspace_exists');
  });
  await t.test('expired trials reject new reservations but retain and allow canceling old ones',async()=>{
   await c1.query("INSERT INTO public.cithela_appointments(tenant_id,status) VALUES($1,'confirmed')",[tenant]);
   await c1.query("UPDATE cithela_private.cithela_commercial_entitlements SET trial_started_at=trial_started_at-interval '8 days',trial_ends_at=trial_ends_at-interval '8 days'");
   await assert.rejects(c1.query("INSERT INTO public.cithela_appointments(tenant_id,status) VALUES($1,'confirmed')",[tenant]),/cithela_subscription_required/);
   await c1.query("UPDATE public.cithela_appointments SET status='cancelled' WHERE tenant_id=$1",[tenant]);assert.equal((await c1.query('SELECT count(*)::int n FROM public.cithela_appointments')).rows[0].n,1);
  });
  await t.test('expired authorizations cannot bootstrap or resume a second trial',async()=>{
   await cmd(c1,a,'configure',{enabled:true,daily_limit:20,active_limit:1,invitation_hours:1});assert.equal((await cmd(c1,w,'admit',{terms_version:'selfservice-trial-20261110'})).code,'grant_ready');
   await c1.query("UPDATE cithela_private.cithela_onboarding_grants SET approved_at=approved_at-interval '2 days',expires_at=expires_at-interval '2 days' WHERE user_id=$1",[w]);await c1.query("UPDATE cithela_private.cithela_selfservice_admissions SET accepted_at=accepted_at-interval '2 days',expires_at=expires_at-interval '2 days' WHERE user_id=$1",[w]);
   assert.equal((await cmd(c1,w,'resume')).code,'no_pending_admission');await c1.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[w]);assert.equal((await c1.query("SELECT cithela_private.bootstrap_tenant('Expired') out")).rows[0].out.code,'onboarding_not_authorized');assert.equal((await cmd(c1,w,'admit',{terms_version:'selfservice-trial-20261110'})).code,'trial_already_used');
  });
  await t.test('daily admission ceiling is atomic across two connections',async()=>{
   const extra='55555555-5555-4555-8555-555555555555';await c1.query('INSERT INTO auth.users VALUES($1,$2,now())',[extra,'four@invalid.example']);
   await cmd(c1,a,'configure',{enabled:true,daily_limit:2,active_limit:100,invitation_hours:24});
   const results=await Promise.all([cmd(c1,loser,'admit',{terms_version:'selfservice-trial-20261110'}),cmd(c2,extra,'admit',{terms_version:'selfservice-trial-20261110'})]);assert.deepEqual(results.map(r=>r.code).sort(),['capacity_reached','grant_ready']);
   assert.equal((await c1.query("SELECT count(*)::int n FROM cithela_private.cithela_selfservice_admissions WHERE accepted_at>now()-interval '24 hours'")).rows[0].n,2);
  });
  await t.test('public roles cannot invoke the privileged command or read the admission ledger',async()=>{for(const role of ['anon','authenticated']){const r=await c1.query("SELECT has_function_privilege($1,'public.cithela_selfservice_command(uuid,uuid,text,jsonb)','execute') fn,has_table_privilege($1,'cithela_private.cithela_selfservice_admissions','select') tbl",[role]);assert.equal(r.rows[0].fn,false);assert.equal(r.rows[0].tbl,false)}});
 }finally{clearInterval(keepalive);if(c1)await c1.end();if(c2)await c2.end();if(db.process?.exitCode!==null)db.process=undefined;await db.stop().catch(()=>{});rmSync(dir,{recursive:true,force:true})}
});
